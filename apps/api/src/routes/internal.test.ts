import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { internalRouter } from './internal';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function postTestSession(): Promise<Response> {
  return internalRouter.request('http://localhost/test/session', { method: 'POST' });
}

async function postTestExpire(token: string): Promise<Response> {
  return internalRouter.request(`http://localhost/test/expire/${token}`, { method: 'POST' });
}

// ─── Environment guard ────────────────────────────────────────────────────────

describe('POST /test/session — environment guard', () => {
  let savedNodeEnv: string | undefined;

  beforeEach(() => {
    savedNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    if (savedNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = savedNodeEnv;
    }
  });

  test('returns 404 with not_found error when NODE_ENV is production', async () => {
    process.env.NODE_ENV = 'production';

    const response = await postTestSession();

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'not_found' });
  });

  test('returns 404 with not_found error when NODE_ENV is development', async () => {
    process.env.NODE_ENV = 'development';

    const response = await postTestSession();

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'not_found' });
  });

  test('does not 404 when NODE_ENV is test (falls through to db layer)', async () => {
    // Keep NODE_ENV as 'test' (the default for bun test).
    // The route exits the env guard and tries to open a database connection
    // which is unavailable in unit-test context, so it returns 503. That
    // status proves the guard itself was NOT triggered.
    process.env.NODE_ENV = 'test';

    const response = await postTestSession();

    expect(response.status).not.toBe(404);
  });
});

// ─── /test/expire environment guard ──────────────────────────────────────────

describe('POST /test/expire/:token — environment guard', () => {
  let savedNodeEnv: string | undefined;

  beforeEach(() => {
    savedNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    if (savedNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = savedNodeEnv;
    }
  });

  test('returns 404 with not_found error when NODE_ENV is production', async () => {
    process.env.NODE_ENV = 'production';

    const response = await postTestExpire('sometoken');

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'not_found' });
  });

  test('returns 404 with not_found error when NODE_ENV is development', async () => {
    process.env.NODE_ENV = 'development';

    const response = await postTestExpire('sometoken');

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'not_found' });
  });

  // No "env guard passes in test" case: both the guard 404 and the "token not
  // found" 404 return the same status and body, making them indistinguishable
  // in a unit test. The two cases above already prove the guard is active for
  // every non-test environment, which is the only invariant worth protecting.
});
