import { describe, expect, test } from 'bun:test';
import { adminLoginStartResponseSchema } from '@anonshare/contracts';
import type { OAuthStateRepository } from '@anonshare/infrastructure/auth';
import type { createDb } from '@anonshare/infrastructure/db';
import { Hono } from 'hono';
import { type AuthRouterDeps, createAuthRouter, parseGithubTokenResponse } from './auth';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ALLOWED_GITHUB_ID = '99999';
const ALLOWED_GITHUB_LOGIN = 'allowed-user';
const SESSION_ID = '00000000-0000-4000-8000-000000000099';
const APP_BASE_URL = 'https://example.com';
const TEST_SECRET = 'test-secret';

/**
 * Generate a Hono-compatible signed cookie value for the given session ID
 * and secret. The format is `value.{HMAC-SHA256(value, secret) base64}`.
 */
async function makeSignedCookieHeader(sessionId: string, secret = TEST_SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(sessionId));
  const b64 = btoa(String.fromCodePoint(...new Uint8Array(sig)));
  return `anonshare_admin_session=${sessionId}.${encodeURIComponent(b64)}`;
}

type DbInsertResult = { id: string }[];

function buildDb(insertResult: DbInsertResult = [{ id: SESSION_ID }]): ReturnType<typeof createDb> {
  return {
    insert: () => ({
      values: () => ({
        returning: async () => insertResult
      })
    }),
    update: () => ({
      set: () => ({
        where: async () => {}
      })
    })
  } as unknown as ReturnType<typeof createDb>;
}

/**
 * In-memory OAuthStateRepository that behaves like the Redis-backed
 * implementation but runs entirely in-process. Supports TTL and atomic consume.
 */
function createInMemoryOAuthStateRepo(): OAuthStateRepository {
  const store = new Map<
    string,
    { data: { redirectTo: string; createdAt: number }; expiresAt: number }
  >();

  return {
    async create(state, redirectTo, ttlMs) {
      store.set(state, {
        data: { redirectTo, createdAt: Date.now() },
        expiresAt: Date.now() + ttlMs
      });
    },
    async read(state) {
      const entry = store.get(state);
      if (!entry || Date.now() > entry.expiresAt) {
        if (entry) store.delete(state);
        return null;
      }
      return entry.data;
    },
    async consume(state) {
      const entry = store.get(state);
      if (!entry || Date.now() > entry.expiresAt) {
        if (entry) store.delete(state);
        return null;
      }
      store.delete(state);
      return entry.data;
    }
  };
}

function buildDeps(overrides: Partial<AuthRouterDeps> = {}): AuthRouterDeps {
  return {
    getDb: () => buildDb(),
    getGithubClientId: () => 'test-client-id',
    getGithubClientSecret: () => 'test-client-secret',
    getAllowedGithubUserId: () => ALLOWED_GITHUB_ID,
    getSessionSecret: () => 'test-secret',
    getAppBaseUrl: () => APP_BASE_URL,
    getAppEnv: () => 'development',
    now: () => new Date('2026-03-18T12:00:00Z'),
    exchangeCodeForToken: async () => ({
      access_token: 'gho_test_token',
      token_type: 'bearer',
      scope: 'read:user'
    }),
    fetchGitHubUser: async () => ({
      id: Number(ALLOWED_GITHUB_ID),
      login: ALLOWED_GITHUB_LOGIN
    }),
    oauthStateRepo: createInMemoryOAuthStateRepo(),
    ...overrides
  };
}

function buildApp(overrides: Partial<AuthRouterDeps> = {}): Hono {
  const app = new Hono();
  app.route('/admin/auth', createAuthRouter(buildDeps(overrides)));
  return app;
}

async function initiateLogin(
  app: Hono,
  query = ''
): Promise<{ authorizationUrl: string; state: string }> {
  const response = await app.request(`http://localhost/admin/auth/login${query}`);
  if (!response.ok) throw new Error('Login initiation request failed');
  const body = await response.json();
  const parsed = adminLoginStartResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('Login initiation response validation failed');
  return parsed.data;
}

// ─── GET /admin/auth/login ────────────────────────────────────────────────────

describe('GET /admin/auth/login', () => {
  test('returns authorizationUrl and state', async () => {
    const app = buildApp();
    const response = await app.request('http://localhost/admin/auth/login');

    expect(response.status).toBe(200);
    const body = await response.json();
    const parsed = adminLoginStartResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
  });

  test('includes client_id in authorizationUrl', async () => {
    const app = buildApp();
    const response = await app.request('http://localhost/admin/auth/login');
    const body = (await response.json()) as { authorizationUrl: string };

    expect(body.authorizationUrl).toContain('client_id=test-client-id');
  });

  test('includes callback URL using app base URL', async () => {
    const app = buildApp();
    const response = await app.request('http://localhost/admin/auth/login');
    const body = (await response.json()) as { authorizationUrl: string };

    expect(body.authorizationUrl).toContain(
      encodeURIComponent(`${APP_BASE_URL}/api/admin/auth/callback`)
    );
  });

  test('state is unique per request', async () => {
    const app = buildApp();
    const [r1, r2] = await Promise.all([
      app.request('http://localhost/admin/auth/login'),
      app.request('http://localhost/admin/auth/login')
    ]);
    const b1 = (await r1.json()) as { state: string };
    const b2 = (await r2.json()) as { state: string };

    expect(b1.state).not.toBe(b2.state);
  });

  test('marks login initiation responses as no-store', async () => {
    const app = buildApp();
    const response = await app.request('http://localhost/admin/auth/login');

    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

// ─── GET /admin/auth/callback ─────────────────────────────────────────────────

describe('GET /admin/auth/callback', () => {
  test('redirects to /admin on successful authentication', async () => {
    const app = buildApp();
    const login = await initiateLogin(app);

    const response = await app.request(
      `http://localhost/admin/auth/callback?code=github_code_123&state=${encodeURIComponent(login.state)}`
    );

    expect(response.status).toBe(302);
    const location = response.headers.get('location');
    expect(location).toContain('/admin');
    expect(location).not.toContain('error=');
  });

  test('preserves admin redirect targets after successful authentication', async () => {
    const app = buildApp();
    const login = await initiateLogin(app, '?redirect=%2Fadmin%3Ftab%3Dreports');

    const response = await app.request(
      `http://localhost/admin/auth/callback?code=github_code_123&state=${encodeURIComponent(login.state)}`
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${APP_BASE_URL}/admin?tab=reports`);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  test('falls back to /admin when login redirect target is outside the admin area', async () => {
    const app = buildApp();
    const login = await initiateLogin(app, '?redirect=%2Fshare%2Fpublic-token');

    const response = await app.request(
      `http://localhost/admin/auth/callback?code=github_code_123&state=${encodeURIComponent(login.state)}`
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${APP_BASE_URL}/admin`);
  });

  test('falls back to /admin when login redirect target escapes admin via path traversal', async () => {
    const app = buildApp();
    const login = await initiateLogin(app, '?redirect=%2Fadmin%2F..%2Fshare%3Ftoken%3Dabc');

    const response = await app.request(
      `http://localhost/admin/auth/callback?code=github_code_123&state=${encodeURIComponent(login.state)}`
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${APP_BASE_URL}/admin`);
  });

  test('falls back to /admin when login redirect target only starts with the admin prefix', async () => {
    const app = buildApp();
    const login = await initiateLogin(app, '?redirect=%2Fadminx%3Ftab%3Dreports');

    const response = await app.request(
      `http://localhost/admin/auth/callback?code=github_code_123&state=${encodeURIComponent(login.state)}`
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${APP_BASE_URL}/admin`);
  });

  test('sets anonshare_admin_session cookie on success', async () => {
    const app = buildApp();
    const login = await initiateLogin(app);

    const response = await app.request(
      `http://localhost/admin/auth/callback?code=valid_code&state=${encodeURIComponent(login.state)}`
    );

    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('anonshare_admin_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  test('rejects callback with missing code', async () => {
    const app = buildApp();
    const login = await initiateLogin(app);

    const response = await app.request(
      `http://localhost/admin/auth/callback?state=${encodeURIComponent(login.state)}`
    );

    expect(response.status).toBe(302);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('error=invalid_callback');
  });

  test('rejects callback with unknown state', async () => {
    const app = buildApp();

    const response = await app.request(
      `http://localhost/admin/auth/callback?code=some_code&state=completely_unknown_state_value`
    );

    expect(response.status).toBe(302);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('error=state_expired');
  });

  test('rejects callback when GitHub user is not allowlisted', async () => {
    const app = buildApp({
      fetchGitHubUser: async () => ({ id: 1111, login: 'other-user' }),
      getAllowedGithubUserId: () => ALLOWED_GITHUB_ID
    });
    const login = await initiateLogin(app);

    const response = await app.request(
      `http://localhost/admin/auth/callback?code=valid_code&state=${encodeURIComponent(login.state)}`
    );

    expect(response.status).toBe(302);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('error=not_allowlisted');
  });

  test('state is consumed (single use)', async () => {
    const app = buildApp();
    const login = await initiateLogin(app);

    const callbackUrl = `http://localhost/admin/auth/callback?code=valid_code&state=${encodeURIComponent(login.state)}`;

    // First use succeeds
    const first = await app.request(callbackUrl);
    expect(first.status).toBe(302);
    expect(first.headers.get('location')).not.toContain('error=');

    // Second use with the same state must be rejected
    const second = await app.request(callbackUrl);
    expect(second.status).toBe(302);
    expect(second.headers.get('location')).toContain('error=state_expired');
  });

  test('passes redirect_uri matching the callback URL to exchangeCodeForToken', async () => {
    let capturedRedirectUri: string | undefined;

    const app = buildApp({
      exchangeCodeForToken: async (_code, redirectUri) => {
        capturedRedirectUri = redirectUri;
        return { access_token: 'gho_test_token', token_type: 'bearer', scope: 'read:user' };
      }
    });
    const login = await initiateLogin(app);

    await app.request(
      `http://localhost/admin/auth/callback?code=valid_code&state=${encodeURIComponent(login.state)}`
    );

    expect(capturedRedirectUri).toBe(`${APP_BASE_URL}/api/admin/auth/callback`);
  });

  test('redirects with error when token exchange fails', async () => {
    const app = buildApp({
      exchangeCodeForToken: async () => {
        throw new Error('token exchange failed');
      }
    });
    const login = await initiateLogin(app);

    const response = await app.request(
      `http://localhost/admin/auth/callback?code=bad_code&state=${encodeURIComponent(login.state)}`
    );

    expect(response.status).toBe(302);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('error=token_exchange_failed');
  });

  test('redirects with error when GitHub user fetch fails', async () => {
    const app = buildApp({
      fetchGitHubUser: async () => {
        throw new Error('api failure');
      }
    });
    const login = await initiateLogin(app);

    const response = await app.request(
      `http://localhost/admin/auth/callback?code=valid_code&state=${encodeURIComponent(login.state)}`
    );

    expect(response.status).toBe(302);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('error=user_fetch_failed');
  });

  test('redirects with error when session creation fails', async () => {
    const failingDb = {
      insert: () => ({
        values: () => ({
          returning: async (): Promise<never> => {
            throw new Error('db write error');
          }
        })
      })
    } as unknown as ReturnType<typeof createDb>;

    const app = buildApp({ getDb: () => failingDb });
    const login = await initiateLogin(app);

    const response = await app.request(
      `http://localhost/admin/auth/callback?code=valid_code&state=${encodeURIComponent(login.state)}`
    );

    expect(response.status).toBe(302);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('error=session_creation_failed');
  });
});

// ─── POST /admin/auth/logout ──────────────────────────────────────────────────

describe('POST /admin/auth/logout', () => {
  test('returns 200 with ok when no session cookie present', async () => {
    const app = buildApp();
    const response = await app.request('http://localhost/admin/auth/logout', { method: 'POST' });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });
  });

  test('revokes session and clears cookie when session id is in cookie', async () => {
    const db = {
      update: () => ({
        set: () => ({
          where: async () => {}
        })
      })
    } as unknown as ReturnType<typeof createDb>;

    const app = buildApp({ getDb: () => db });
    const signedCookie = await makeSignedCookieHeader(SESSION_ID);
    const response = await app.request('http://localhost/admin/auth/logout', {
      method: 'POST',
      headers: { cookie: signedCookie }
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });
    expect(response.headers.get('cache-control')).toBe('no-store');

    // Cookie is cleared
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('Max-Age=0');
  });

  test('still returns ok when db revocation fails', async () => {
    const failingDb = {
      update: () => ({
        set: () => ({
          where: async (): Promise<never> => {
            throw new Error('db failure');
          }
        })
      })
    } as unknown as ReturnType<typeof createDb>;

    const app = buildApp({ getDb: () => failingDb });
    const signedCookie = await makeSignedCookieHeader(SESSION_ID);
    const response = await app.request('http://localhost/admin/auth/logout', {
      method: 'POST',
      headers: { cookie: signedCookie }
    });

    // Graceful degradation: still OK even if DB fails
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });
  });
});

// ─── Restart-safe OAuth state ─────────────────────────────────────────────────

describe('OAuth state durability across router instances', () => {
  test('expired oauth state is rejected before callback consumption', async () => {
    const originalNow = Date.now;
    const sharedRepo = createInMemoryOAuthStateRepo();

    try {
      Date.now = () => 1_000;

      const app1 = new Hono();
      app1.route('/admin/auth', createAuthRouter(buildDeps({ oauthStateRepo: sharedRepo })));
      const login = await initiateLogin(app1);

      Date.now = () => 1_000 + 10 * 60 * 1000 + 1;

      const app2 = new Hono();
      app2.route('/admin/auth', createAuthRouter(buildDeps({ oauthStateRepo: sharedRepo })));

      const response = await app2.request(
        `http://localhost/admin/auth/callback?code=github_code_123&state=${encodeURIComponent(login.state)}`
      );

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toContain('error=state_expired');
    } finally {
      Date.now = originalNow;
    }
  });

  test('state created by one router instance can be consumed by a second instance (restart-safe)', async () => {
    const sharedRepo = createInMemoryOAuthStateRepo();

    // Router instance 1 starts the login
    const app1 = new Hono();
    app1.route('/admin/auth', createAuthRouter(buildDeps({ oauthStateRepo: sharedRepo })));
    const login = await initiateLogin(app1);

    // Router instance 2 handles the callback (simulates API restart)
    const app2 = new Hono();
    app2.route('/admin/auth', createAuthRouter(buildDeps({ oauthStateRepo: sharedRepo })));

    const response = await app2.request(
      `http://localhost/admin/auth/callback?code=github_code_123&state=${encodeURIComponent(login.state)}`
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).not.toContain('error=');
  });

  test('state is consumed atomically and cannot be replayed across instances', async () => {
    const sharedRepo = createInMemoryOAuthStateRepo();

    const app1 = new Hono();
    app1.route('/admin/auth', createAuthRouter(buildDeps({ oauthStateRepo: sharedRepo })));
    const login = await initiateLogin(app1);

    // First callback succeeds on a fresh instance
    const app2 = new Hono();
    app2.route('/admin/auth', createAuthRouter(buildDeps({ oauthStateRepo: sharedRepo })));
    const first = await app2.request(
      `http://localhost/admin/auth/callback?code=github_code_123&state=${encodeURIComponent(login.state)}`
    );
    expect(first.status).toBe(302);
    expect(first.headers.get('location')).not.toContain('error=');

    // Replay on yet another instance must be rejected (state already consumed)
    const app3 = new Hono();
    app3.route('/admin/auth', createAuthRouter(buildDeps({ oauthStateRepo: sharedRepo })));
    const second = await app3.request(
      `http://localhost/admin/auth/callback?code=github_code_123&state=${encodeURIComponent(login.state)}`
    );
    expect(second.status).toBe(302);
    expect(second.headers.get('location')).toContain('error=state_expired');
  });
});

// ─── parseGithubTokenResponse ─────────────────────────────────────────────────

describe('parseGithubTokenResponse', () => {
  test('accepts a valid token response with all fields', () => {
    const result = parseGithubTokenResponse({
      access_token: 'gho_abc123',
      token_type: 'bearer',
      scope: 'read:user'
    });

    expect(result).toEqual({
      ok: true,
      data: { access_token: 'gho_abc123', token_type: 'bearer', scope: 'read:user' }
    });
  });

  test('defaults scope to empty string when absent', () => {
    const result = parseGithubTokenResponse({
      access_token: 'gho_abc123',
      token_type: 'bearer'
    });

    expect(result).toEqual({
      ok: true,
      data: { access_token: 'gho_abc123', token_type: 'bearer', scope: '' }
    });
  });

  test('rejects body missing access_token', () => {
    const result = parseGithubTokenResponse({ token_type: 'bearer', scope: 'read:user' });

    expect(result).toEqual({ ok: false, error: 'missing or empty access_token' });
  });

  test('rejects body with empty access_token', () => {
    const result = parseGithubTokenResponse({ access_token: '', token_type: 'bearer' });

    expect(result).toEqual({ ok: false, error: 'missing or empty access_token' });
  });

  test('rejects body with non-string access_token', () => {
    const result = parseGithubTokenResponse({ access_token: 42, token_type: 'bearer' });

    expect(result).toEqual({ ok: false, error: 'missing or empty access_token' });
  });

  test('rejects body missing token_type', () => {
    const result = parseGithubTokenResponse({ access_token: 'gho_abc123' });

    expect(result).toEqual({ ok: false, error: 'missing or empty token_type' });
  });

  test('rejects body with empty token_type', () => {
    const result = parseGithubTokenResponse({ access_token: 'gho_abc123', token_type: '' });

    expect(result).toEqual({ ok: false, error: 'missing or empty token_type' });
  });
});
