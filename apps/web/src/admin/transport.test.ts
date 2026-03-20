import { afterEach, describe, expect, it } from 'bun:test';
// Import the standalone function directly to avoid pulling in transport's
// full import tree (which depends on @anonshare/contracts + fetch globals).
// The function is re-exported here for isolated unit testing.
import { extractErrorMessage, logoutAdmin } from './transport';

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
