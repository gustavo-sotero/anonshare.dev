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
