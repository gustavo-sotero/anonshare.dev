import type { Redis } from 'ioredis';

export type RateLimitResult = {
  /** Whether the caller exceeded the limit for this window. */
  limited: boolean;
  /** Number of actions recorded in the current window (after this call). */
  count: number;
  /** Maximum allowed actions per window. */
  limit: number;
  /** Seconds until the current window resets (Redis TTL). */
  resetInSeconds: number;
};

/**
 * Origin of the rate-limit decision.
 * `redis` means the primary Redis counter was used.
 * `memory-fallback` means Redis was unavailable and the process-local
 * fixed-window fallback was used instead.  The fallback is NOT shared
 * across instances and is intentionally conservative.
 */
export type RateLimitOrigin = 'redis' | 'memory-fallback';

export type RateLimitOutcome = RateLimitResult & {
  origin: RateLimitOrigin;
};

export type DailyRateLimitBlockedCount = {
  day: string;
  count: number;
};

const RATE_LIMIT_BLOCKED_METRIC_PREFIX = 'metrics:rate_limit_blocked';
const RATE_LIMIT_BLOCKED_METRIC_RETENTION_SECONDS = 35 * 24 * 60 * 60;

export const RATE_LIMIT_BLOCKED_METRIC_SURFACES = [
  'upload',
  'report',
  'report_per_file',
  'share_metadata',
  'share_metadata_token',
  'download',
  'download_token',
  'preview',
  'preview_token'
] as const;

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function formatUtcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function blockedMetricKey(surface: string, day: string): string {
  return `${RATE_LIMIT_BLOCKED_METRIC_PREFIX}:${surface}:${day}`;
}

/**
 * Fixed-window rate limiter backed by Redis INCR + EXPIRE.
 *
 * Each unique `key` gets its own counter that resets after `windowSeconds`.
 * Safe for concurrent calls — INCR is atomic.
 *
 * Caller is responsible for constructing meaningful, collision-free keys.
 * IP addresses must be hashed before use; never pass raw IPs.
 *
 * @example
 *   const key = `rl:upload:${hashedIp}`;
 *   const result = await checkRateLimit(redis, key, 20, 3600);
 *   if (result.limited) { return 429; }
 */
export async function checkRateLimit(
  redis: Redis,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const count = await redis.incr(key);

  // Only set the TTL on the first increment to avoid resetting the window on
  // every request. If the key already existed with no TTL (unlikely but safe),
  // EXPIRE is a no-op for keys that already have a TTL set before count === 1.
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }

  // TTL can be -1 (no expiry) or -2 (key gone — race). Re-apply expiry to
  // avoid retaining counters indefinitely when keys lose TTL unexpectedly.
  const ttl = await redis.ttl(key);
  if (ttl <= 0) {
    await redis.expire(key, windowSeconds);
  }

  const resetInSeconds = ttl > 0 ? ttl : windowSeconds;

  return {
    limited: count > limit,
    count,
    limit,
    resetInSeconds
  };
}

// ─── In-memory fallback ───────────────────────────────────────────────────────

type MemoryBucket = { count: number; resetAt: number };

/**
 * Process-local fixed-window store used when Redis is unavailable.
 * NOT shared across instances — treats the limit conservatively.
 * Capped at MEMORY_MAX_KEYS entries; expired buckets are evicted when the
 * map reaches capacity to bound memory usage.
 */
const _memoryStore = new Map<string, MemoryBucket>();
const MEMORY_MAX_KEYS = 10_000;

function checkMemoryRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  now: number = Date.now()
): RateLimitOutcome {
  if (_memoryStore.size >= MEMORY_MAX_KEYS) {
    for (const [k, v] of _memoryStore) {
      if (v.resetAt <= now) _memoryStore.delete(k);
    }
  }

  const existing = _memoryStore.get(key);
  let bucket: MemoryBucket;

  if (!existing || existing.resetAt <= now) {
    bucket = { count: 1, resetAt: now + windowSeconds * 1000 };
    _memoryStore.set(key, bucket);
  } else {
    existing.count += 1;
    bucket = existing;
  }

  const resetInSeconds = Math.max(0, Math.ceil((bucket.resetAt - now) / 1000));
  return {
    limited: bucket.count > limit,
    count: bucket.count,
    limit,
    resetInSeconds,
    origin: 'memory-fallback'
  };
}

/**
 * Centralised rate-limit check with automatic Redis-failure fallback.
 *
 * Returns a `RateLimitOutcome` that includes `origin` so callers can emit
 * telemetry when the fallback is active.  Callers do NOT need a try/catch —
 * this function is safe to `await` unconditionally.
 *
 * When Redis throws, an in-memory fixed-window counter takes over for the
 * duration of the outage.  The fallback is per-process and conservative; it
 * is not a replacement for Redis and must be treated as a degraded mode only.
 */
export async function applyRateLimit(
  redis: Redis,
  key: string,
  limit: number,
  windowSeconds: number,
  log: { warn: (message: string, ctx: Record<string, unknown>) => void }
): Promise<RateLimitOutcome> {
  try {
    const result = await checkRateLimit(redis, key, limit, windowSeconds);
    return { ...result, origin: 'redis' };
  } catch (err) {
    log.warn('Rate limit degraded: falling back to in-memory counter', {
      event: 'rate_limit.degraded',
      key,
      error: err instanceof Error ? err.message : String(err)
    });
    return checkMemoryRateLimit(key, limit, windowSeconds);
  }
}

export async function recordRateLimitBlocked(
  redis: Redis,
  surface: string,
  now: Date = new Date()
): Promise<void> {
  const day = formatUtcDay(startOfUtcDay(now));
  const key = blockedMetricKey(surface, day);

  await redis.incr(key);
  await redis.expire(key, RATE_LIMIT_BLOCKED_METRIC_RETENTION_SECONDS);
}

export async function listRateLimitBlockedCountsByDay(
  redis: Redis,
  surfaces: readonly string[],
  startInclusiveUtc: Date,
  windowDays: number
): Promise<DailyRateLimitBlockedCount[]> {
  if (windowDays < 1) {
    return [];
  }

  const startDay = startOfUtcDay(startInclusiveUtc);
  const days: string[] = [];
  const keys: string[] = [];

  for (let offset = 0; offset < windowDays; offset += 1) {
    const dayDate = new Date(startDay);
    dayDate.setUTCDate(startDay.getUTCDate() + offset);
    const day = formatUtcDay(dayDate);
    days.push(day);

    for (const surface of surfaces) {
      keys.push(blockedMetricKey(surface, day));
    }
  }

  const values = keys.length > 0 ? await redis.mget(...keys) : [];

  let cursor = 0;
  return days.map((day) => {
    let total = 0;

    for (let surfaceIndex = 0; surfaceIndex < surfaces.length; surfaceIndex += 1) {
      const raw = values[cursor] ?? null;
      cursor += 1;

      if (!raw) {
        continue;
      }

      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) {
        total += parsed;
      }
    }

    return { day, count: total };
  });
}
