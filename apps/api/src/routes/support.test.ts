import { describe, expect, test } from 'bun:test';
import {
  errorBody,
  hashIp,
  parseShareToken,
  persistEventBestEffort,
  readCookieValue,
  recordBlockedMetricBestEffort
} from './support';

// ── persistEventBestEffort ────────────────────────────────────────────────────

describe('persistEventBestEffort', () => {
  const baseCtx = {
    event: 'download.completed',
    requestId: 'req-1',
    entity: { type: 'file', id: 'f-1' },
    eventType: 'completed'
  };

  test('does not throw when the operation succeeds', async () => {
    const log = { warn: () => {} };
    await expect(persistEventBestEffort(Promise.resolve(), baseCtx, log)).resolves.toBeUndefined();
  });

  test('emits a structured warning when the operation rejects', async () => {
    const captured: Array<[string, Record<string, unknown>]> = [];
    const log = {
      warn: (msg: string, ctx: Record<string, unknown>) => {
        captured.push([msg, ctx]);
      }
    };

    await persistEventBestEffort(Promise.reject(new Error('DB insert failed')), baseCtx, log);

    expect(captured).toHaveLength(1);
    const entry = captured[0];
    expect(entry).toBeDefined();
    const [msg, ctx] = entry as [string, Record<string, unknown>];
    expect(msg).toBe('Download event persistence failed');
    expect(ctx.event).toBe('download_event_write_failed');
    expect(ctx.requestId).toBe('req-1');
    expect(ctx.entity).toEqual({ type: 'file', id: 'f-1' });
    expect(ctx.eventType).toBe('completed');
    expect(ctx.outcome).toBe('failure');
    expect(ctx.error).toBe('DB insert failed');
  });

  test('converts non-Error rejections to string', async () => {
    const captured: Array<[string, Record<string, unknown>]> = [];
    const log = {
      warn: (_msg: string, ctx: Record<string, unknown>) => {
        captured.push(['', ctx]);
      }
    };

    await persistEventBestEffort(Promise.reject('plain string error'), baseCtx, log);

    expect(captured).toHaveLength(1);
    const entry = captured[0] as [string, Record<string, unknown>];
    expect(entry[1].error).toBe('plain string error');
  });
});

// ── recordBlockedMetricBestEffort ─────────────────────────────────────────────

describe('recordBlockedMetricBestEffort', () => {
  test('does not throw when the metric write succeeds', async () => {
    const log = { warn: () => {} };
    recordBlockedMetricBestEffort(Promise.resolve(), 'upload', log);
    // No assertion needed — just verifying no uncaught rejection
    await new Promise((r) => setTimeout(r, 10));
  });

  test('emits a structured warning when the metric write fails', async () => {
    const captured: Array<[string, Record<string, unknown>]> = [];
    const log = {
      warn: (msg: string, ctx: Record<string, unknown>) => {
        captured.push([msg, ctx]);
      }
    };

    recordBlockedMetricBestEffort(Promise.reject(new Error('Redis timeout')), 'download', log);

    // Allow microtask to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(captured).toHaveLength(1);
    const entry = captured[0];
    expect(entry).toBeDefined();
    const [msg, ctx] = entry as [string, Record<string, unknown>];
    expect(msg).toBe('Rate-limit blocked metric write failed');
    expect(ctx.event).toBe('rate_limit_metric_write_failed');
    expect(ctx.surface).toBe('download');
    expect(ctx.outcome).toBe('failure');
    expect(ctx.error).toBe('Redis timeout');
  });
});

// ── hashIp ────────────────────────────────────────────────────────────────────

describe('hashIp', () => {
  test('returns null for empty or undefined input', async () => {
    expect(await hashIp(undefined)).toBeNull();
    expect(await hashIp('')).toBeNull();
  });

  test('hashes the first IP from a comma-separated list', async () => {
    const hash = await hashIp('10.0.0.1, 192.168.1.1');
    expect(hash).toBeTruthy();
    expect(hash?.length).toBe(32);
    // Same input produces same hash
    expect(await hashIp('10.0.0.1, 192.168.1.1')).toBe(hash);
  });

  test('trims whitespace from the IP before hashing', async () => {
    const withSpace = await hashIp('  10.0.0.1  ');
    const without = await hashIp('10.0.0.1');
    expect(withSpace).toBe(without);
  });

  test('supports keyed HMAC hashing for privacy-scoped pseudonyms', async () => {
    const keyed = await hashIp('10.0.0.1', 'session-secret-that-is-long-enough');
    const keyedAgain = await hashIp('10.0.0.1', 'session-secret-that-is-long-enough');
    const differentSecret = await hashIp('10.0.0.1', 'another-secret-that-is-long-enough');

    expect(keyed).toBeTruthy();
    expect(keyed?.length).toBe(32);
    expect(keyedAgain).toBe(keyed);
    expect(differentSecret).not.toBe(keyed);
  });
});

// ── parseShareToken ───────────────────────────────────────────────────────────

describe('parseShareToken', () => {
  test('returns the token when it matches the canonical format', () => {
    expect(parseShareToken('Abc123defghijkl012')).toBe('Abc123defghijkl012');
  });

  test('returns null for malformed tokens', () => {
    expect(parseShareToken('bad!')).toBeNull();
    expect(parseShareToken('')).toBeNull();
  });
});

// ── readCookieValue ───────────────────────────────────────────────────────────

describe('readCookieValue', () => {
  test('returns null for undefined header', () => {
    expect(readCookieValue(undefined, 'session')).toBeNull();
  });

  test('parses a simple cookie value', () => {
    expect(readCookieValue('session=abc123', 'session')).toBe('abc123');
  });

  test('parses URI-encoded cookie values', () => {
    expect(readCookieValue('session=hello%20world', 'session')).toBe('hello world');
  });

  test('returns raw value when decoding fails', () => {
    expect(readCookieValue('session=%ZZ', 'session')).toBe('%ZZ');
  });

  test('returns null for missing cookie name', () => {
    expect(readCookieValue('other=value', 'session')).toBeNull();
  });

  test('handles cookies with = in value', () => {
    expect(readCookieValue('token=abc=def=ghi', 'token')).toBe('abc=def=ghi');
  });
});

// ── errorBody ─────────────────────────────────────────────────────────────────

describe('errorBody', () => {
  test('returns standard error envelope', () => {
    expect(errorBody('NOT_FOUND', 'Not found')).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Not found' }
    });
  });

  test('includes optional details', () => {
    const result = errorBody('VALIDATION', 'Invalid', { field: 'size' });
    expect(result.error.details).toEqual({ field: 'size' });
  });

  test('omits details key when not provided', () => {
    const result = errorBody('ERR', 'msg');
    expect('details' in result.error).toBe(false);
  });
});
