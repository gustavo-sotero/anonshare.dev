import { afterEach, describe, expect, it } from 'bun:test';
// Import the standalone function directly to avoid pulling in transport's
// full import tree (which depends on @anonshare/contracts + fetch globals).
// The function is re-exported here for isolated unit testing.
import { extractErrorMessage, loadDashboardState, logoutAdmin } from './transport';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('extractErrorMessage', () => {
  it('extracts a top-level message field', () => {
    expect(extractErrorMessage({ message: 'Not found' }, 'fallback')).toBe('Not found');
  });

  it('extracts a nested error.message field', () => {
    expect(extractErrorMessage({ error: { message: 'Validation failed' } }, 'fallback')).toBe(
      'Validation failed'
    );
  });

  it('returns the fallback for null or undefined bodies', () => {
    expect(extractErrorMessage(null, 'oops')).toBe('oops');
    expect(extractErrorMessage(undefined, 'oops')).toBe('oops');
  });

  it('returns the fallback when the body is a non-object', () => {
    expect(extractErrorMessage('string body', 'fallback')).toBe('fallback');
    expect(extractErrorMessage(42, 'fallback')).toBe('fallback');
  });

  it('returns the fallback when no recognized message field is present', () => {
    expect(extractErrorMessage({ code: 'ERR' }, 'fallback')).toBe('fallback');
  });
});

describe('logoutAdmin', () => {
  it('returns ok=true when the server confirms logout', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })) as unknown as typeof fetch;

    expect(await logoutAdmin()).toEqual({ ok: true });
  });

  it('returns ok=false with extracted message when the server responds with an error status', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: { message: 'Redis unavailable during session revocation.' }
        }),
        {
          status: 500,
          headers: { 'content-type': 'application/json' }
        }
      )) as unknown as typeof fetch;

    expect(await logoutAdmin()).toEqual({
      ok: false,
      message: 'Redis unavailable during session revocation.'
    });
  });

  it('returns ok=false when the request fails before a response is received', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network unreachable');
    }) as unknown as typeof fetch;

    expect(await logoutAdmin()).toEqual({
      ok: false,
      message: 'network unreachable'
    });
  });
});

// ─── loadDashboardState ───────────────────────────────────────────────────────

const SESSION_FIXTURE = {
  id: 'b5f12a3e-4c2d-4e5f-8a6b-7c9d0e1f2a3b',
  githubId: '123456',
  githubLogin: 'admin',
  expiresAt: '2099-12-31T23:59:59.000Z'
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('loadDashboardState', () => {
  it('returns error state when the session fetch throws a network error', async () => {
    globalThis.fetch = (() => {
      throw new Error('network error');
    }) as unknown as typeof fetch;

    const result = await loadDashboardState();

    expect(result).toEqual({ kind: 'error', message: 'network error' });
  });

  it('returns unauthenticated state when the session fetch returns 401', async () => {
    globalThis.fetch = (() =>
      jsonResponse(
        { reason: 'session_required', message: 'Please sign in.' },
        401
      )) as unknown as typeof fetch;

    const result = await loadDashboardState();

    expect(result).toEqual({ kind: 'unauthenticated' });
  });

  it('returns unauthenticated state when the session response is not authenticated', async () => {
    globalThis.fetch = (() =>
      jsonResponse({ authenticated: false, session: null })) as unknown as typeof fetch;

    const result = await loadDashboardState();

    expect(result).toEqual({ kind: 'unauthenticated' });
  });

  it('returns unauthenticated state with error when a parallel data fetch returns 401', async () => {
    let callCount = 0;
    globalThis.fetch = (() => {
      callCount++;
      if (callCount === 1) {
        return jsonResponse({ authenticated: true, session: SESSION_FIXTURE });
      }
      return jsonResponse({ reason: 'session_expired', message: 'Session expired.' }, 401);
    }) as unknown as typeof fetch;

    const result = await loadDashboardState();

    expect(result.kind).toBe('unauthenticated');
    if (result.kind === 'unauthenticated') {
      expect(result.error).toBe('Your admin session expired. Please sign in again.');
    }
  });

  it('returns error state when a parallel data fetch throws a generic error', async () => {
    let callCount = 0;
    globalThis.fetch = (() => {
      callCount++;
      if (callCount === 1) {
        return jsonResponse({ authenticated: true, session: SESSION_FIXTURE });
      }
      throw new Error('upstream timeout');
    }) as unknown as typeof fetch;

    const result = await loadDashboardState();

    expect(result).toEqual({ kind: 'error', message: 'upstream timeout' });
  });
});
