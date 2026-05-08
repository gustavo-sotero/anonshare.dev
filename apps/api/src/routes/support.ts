import { shareTokenParamsSchema } from '@anonshare/contracts';
import { createDb } from '@anonshare/infrastructure/db';
import type { Context } from 'hono';

// ─── Lazy DB singleton ────────────────────────────────────────────────────────

let _db: ReturnType<typeof createDb> | null = null;

/**
 * Shared lazy DB accessor for route handlers.
 * Defers initialization to first use so importing route modules in tests
 * (where DATABASE_URL may not be set) does not fail at module load time.
 */
export function getDb(): ReturnType<typeof createDb> {
  if (!_db) {
    _db = createDb();
  }
  return _db;
}

// ─── Request ID ───────────────────────────────────────────────────────────────

/**
 * Extract the request ID from an incoming Hono context, falling back to a
 * freshly generated UUID when the header is absent.
 */
export function getRequestId(c: Context): string {
  return c.req.header('x-request-id') ?? crypto.randomUUID();
}

// ─── IP hashing ───────────────────────────────────────────────────────────────

/**
 * Pseudonymise an IP address for rate-limit keys and download event logging.
 * PRD §8.2: Never store plaintext IPs for anonymous operations.
 *
 * Takes the first IP from a potentially comma-separated X-Forwarded-For value.
 * When a `secret` is provided, computes HMAC-SHA256 keyed with that secret and
 * a purpose prefix so the hash is purpose-scoped and not invertible via rainbow
 * tables. Falls back to plain SHA-256 when no secret is given (test paths).
 *
 * Returns the first 32 hex characters of the resulting digest.
 */
export async function hashIp(raw?: string, secret?: string): Promise<string | null> {
  if (!raw) return null;
  const firstIp = raw.split(',')[0];
  if (!firstIp) return null;
  const ip = firstIp.trim();

  if (secret) {
    const keyData = new TextEncoder().encode(secret);
    const messageData = new TextEncoder().encode(`ip-privacy:${ip}`);
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, messageData);
    return Buffer.from(signature).toString('hex').slice(0, 32);
  }

  const data = new TextEncoder().encode(ip);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Buffer.from(digest).toString('hex').slice(0, 32);
}

// ─── Share token parsing ──────────────────────────────────────────────────────

/**
 * Validate and extract a share token from a raw URL parameter.
 * Returns null when the token does not match the canonical format.
 */
export function parseShareToken(token: string): string | null {
  const parsed = shareTokenParamsSchema.safeParse({ token });
  return parsed.success ? parsed.data.token : null;
}

// ─── Cookie parsing ───────────────────────────────────────────────────────────

/**
 * Read a single cookie value from a raw Cookie header string.
 * Handles URI-encoded values and malformed cookies gracefully.
 */
export function readCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName !== name || rest.length === 0) continue;

    const rawValue = rest.join('=');
    if (!rawValue) return null;

    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return null;
}

// ─── Error response body ──────────────────────────────────────────────────────

/**
 * Build a standard API error response body.
 * All public API error responses share this shape so clients can handle
 * errors uniformly.
 */
export function errorBody(
  code: string,
  message: string,
  details?: Record<string, string>
): { ok: false; error: { code: string; message: string; details?: Record<string, string> } } {
  return { ok: false as const, error: { code, message, ...(details ? { details } : {}) } };
}

// ─── Non-throwing telemetry helpers ───────────────────────────────────────────

/**
 * Execute a telemetry/event-persistence operation without throwing.
 * On failure, logs a structured warning with the provided context so the
 * failure is diagnosable without blocking the user-facing request path.
 */
export async function persistEventBestEffort(
  operation: Promise<unknown>,
  context: {
    event: string;
    requestId: string;
    entity: { type: string; id: string };
    eventType: string;
  },
  log: { warn: (message: string, ctx: Record<string, unknown>) => void }
): Promise<void> {
  try {
    await operation;
  } catch (err) {
    log.warn('Download event persistence failed', {
      event: 'download_event_write_failed',
      requestId: context.requestId,
      entity: context.entity,
      eventType: context.eventType,
      outcome: 'failure',
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

/**
 * Record a rate-limit blocked metric without throwing.
 * The metric is best-effort — failure must never block the user response
 * but must emit a structured log so operational visibility is not lost.
 */
export function recordBlockedMetricBestEffort(
  operation: Promise<void>,
  surface: string,
  log: { warn: (message: string, ctx: Record<string, unknown>) => void }
): void {
  operation.catch((err) => {
    log.warn('Rate-limit blocked metric write failed', {
      event: 'rate_limit_metric_write_failed',
      surface,
      outcome: 'failure',
      error: err instanceof Error ? err.message : String(err)
    });
  });
}
