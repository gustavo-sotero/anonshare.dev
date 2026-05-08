import { adminLoginCallbackSchema } from '@anonshare/contracts';
import type { OAuthStateRepository } from '@anonshare/infrastructure/auth';
import { createOAuthStateRepository } from '@anonshare/infrastructure/auth';
import { app as appConfig, auth as authConfig } from '@anonshare/infrastructure/config';
import { createDb } from '@anonshare/infrastructure/db';
import { adminSessions } from '@anonshare/infrastructure/db/schema';
import type { Redis } from '@anonshare/infrastructure/redis';
import { getRedisClient } from '@anonshare/infrastructure/redis';
import { eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { logger } from '../logger';
import { ADMIN_SESSION_COOKIE_NAME } from './admin/types';
import { getRequestId } from './support';

const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';

function generateOAuthState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const base64 = btoa(String.fromCodePoint(...bytes));
  return base64.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function setNoStoreHeaders(c: Context): void {
  c.header('cache-control', 'no-store');
}

function sanitizeAdminRedirectTarget(rawRedirectTo: string | undefined): string {
  if (!rawRedirectTo) {
    return '/admin';
  }

  const candidate = rawRedirectTo.trim();
  if (!candidate.startsWith('/') || candidate.startsWith('//')) {
    return '/admin';
  }

  try {
    const parsed = new URL(candidate, 'http://localhost');
    const normalizedPath = parsed.pathname;
    const isAdminPath = normalizedPath === '/admin' || normalizedPath.startsWith('/admin/');

    if (!isAdminPath) {
      return '/admin';
    }

    return `${normalizedPath}${parsed.search}${parsed.hash}`;
  } catch {
    return '/admin';
  }
}

type GitHubTokenResponse = {
  access_token: string;
  token_type: string;
  scope: string;
};

type GitHubUserResponse = {
  id: number;
  login: string;
};

export type AuthRouterDeps = {
  getDb?: () => ReturnType<typeof createDb>;
  getGithubClientId?: () => string;
  getGithubClientSecret?: () => string;
  getAllowedGithubUserId?: () => string;
  getSessionSecret?: () => string;
  getAppBaseUrl?: () => string;
  getAppEnv?: () => string;
  now?: () => Date;
  exchangeCodeForToken?: (code: string) => Promise<GitHubTokenResponse>;
  fetchGitHubUser?: (accessToken: string) => Promise<GitHubUserResponse>;
  oauthStateRepo?: OAuthStateRepository;
  getRedis?: () => Redis;
};

let _db: ReturnType<typeof createDb> | null = null;

function defaultGetDb() {
  if (!_db) {
    _db = createDb();
  }
  return _db;
}

let _oauthStateRepo: OAuthStateRepository | null = null;

function defaultGetOAuthStateRepo(): OAuthStateRepository {
  if (!_oauthStateRepo) {
    _oauthStateRepo = createOAuthStateRepository(getRedisClient());
  }
  return _oauthStateRepo;
}

async function defaultExchangeCodeForToken(code: string): Promise<GitHubTokenResponse> {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      client_id: authConfig.githubClientId(),
      client_secret: authConfig.githubClientSecret(),
      code
    })
  });

  if (!response.ok) {
    throw new Error(`GitHub token exchange failed: ${response.status}`);
  }

  const body = (await response.json()) as Record<string, unknown>;

  if (typeof body.error === 'string') {
    throw new Error(`GitHub OAuth error: ${body.error}`);
  }

  if (typeof body.access_token !== 'string') {
    throw new Error('GitHub token exchange returned no access_token');
  }

  return body as unknown as GitHubTokenResponse;
}

async function defaultFetchGitHubUser(accessToken: string): Promise<GitHubUserResponse> {
  const response = await fetch(GITHUB_USER_URL, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub user fetch failed: ${response.status}`);
  }

  const body = (await response.json()) as Record<string, unknown>;

  if (typeof body.id !== 'number' || typeof body.login !== 'string') {
    throw new Error('GitHub user response missing id or login');
  }

  return { id: body.id, login: body.login };
}

export function createAuthRouter(deps: AuthRouterDeps = {}): Hono {
  const resolvedDeps = {
    getDb: deps.getDb ?? defaultGetDb,
    getGithubClientId: deps.getGithubClientId ?? authConfig.githubClientId,
    getGithubClientSecret: deps.getGithubClientSecret ?? authConfig.githubClientSecret,
    getAllowedGithubUserId: deps.getAllowedGithubUserId ?? authConfig.githubAllowedUserId,
    getSessionSecret: deps.getSessionSecret ?? authConfig.sessionSecret,
    getAppBaseUrl: deps.getAppBaseUrl ?? appConfig.baseUrl,
    getAppEnv: deps.getAppEnv ?? appConfig.env,
    now: deps.now ?? (() => new Date()),
    exchangeCodeForToken: deps.exchangeCodeForToken ?? defaultExchangeCodeForToken,
    fetchGitHubUser: deps.fetchGitHubUser ?? defaultFetchGitHubUser
  };

  function getOAuthStateRepo(): OAuthStateRepository {
    return deps.oauthStateRepo ?? defaultGetOAuthStateRepo();
  }

  const router = new Hono();

  router.use('*', async (c, next) => {
    setNoStoreHeaders(c);
    await next();
  });

  // ─── GET /auth/login ─────────────────────────────────────────────────────
  // Initiates the GitHub OAuth flow. Returns the authorization URL and state
  // for the client to redirect the browser.
  router.get('/login', async (c) => {
    const requestId = getRequestId(c);

    const state = generateOAuthState();
    const redirectTo = sanitizeAdminRedirectTarget(c.req.query('redirect'));

    await getOAuthStateRepo().create(state, redirectTo, OAUTH_STATE_TTL_MS);

    const clientId = resolvedDeps.getGithubClientId();
    const baseUrl = resolvedDeps.getAppBaseUrl();
    const callbackUrl = `${baseUrl}/api/admin/auth/callback`;

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      state,
      scope: 'read:user'
    });

    const authorizationUrl = `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;

    logger.info('Admin OAuth login initiated', {
      event: 'admin.login_initiated',
      requestId,
      actor: 'admin',
      entity: { type: 'oauth', id: 'github' },
      outcome: 'success'
    });

    return c.json({ authorizationUrl, state }, 200);
  });

  // ─── GET /auth/callback ──────────────────────────────────────────────────
  // GitHub redirects here after user authorizes. Exchanges code for token,
  // fetches user profile, validates allowlist, creates session, sets cookie,
  // redirects to admin dashboard.
  router.get('/callback', async (c) => {
    const requestId = getRequestId(c);

    const code = c.req.query('code');
    const state = c.req.query('state');

    const parsed = adminLoginCallbackSchema.safeParse({ code, state });

    if (!parsed.success) {
      logger.warn('Admin OAuth callback: invalid parameters', {
        event: 'admin.login_denied',
        requestId,
        actor: 'admin',
        entity: { type: 'oauth', id: 'github' },
        outcome: 'failure',
        reason: 'invalid_callback_params'
      });
      return c.redirect(`${resolvedDeps.getAppBaseUrl()}/admin?error=invalid_callback`);
    }

    // Atomically consume the state token (single-use, TTL-protected, restart-safe).
    // Returns null if the state was never set, already consumed, or expired.
    const stateEntry = await getOAuthStateRepo().consume(parsed.data.state);
    if (!stateEntry) {
      logger.warn('Admin OAuth callback: state mismatch, expired, or already consumed', {
        event: 'admin.login_denied',
        requestId,
        actor: 'admin',
        entity: { type: 'oauth', id: 'github' },
        outcome: 'failure',
        reason: 'state_mismatch'
      });
      return c.redirect(`${resolvedDeps.getAppBaseUrl()}/admin?error=state_expired`);
    }

    // Exchange authorization code for access token
    let tokenResponse: GitHubTokenResponse;
    try {
      tokenResponse = await resolvedDeps.exchangeCodeForToken(parsed.data.code);
    } catch (err) {
      logger.error('Admin OAuth callback: token exchange failed', {
        event: 'admin.login_denied',
        requestId,
        actor: 'admin',
        entity: { type: 'oauth', id: 'github' },
        outcome: 'failure',
        reason: 'token_exchange_failed',
        error: err instanceof Error ? err.message : String(err)
      });
      return c.redirect(`${resolvedDeps.getAppBaseUrl()}/admin?error=token_exchange_failed`);
    }

    // Fetch user profile from GitHub
    let githubUser: GitHubUserResponse;
    try {
      githubUser = await resolvedDeps.fetchGitHubUser(tokenResponse.access_token);
    } catch (err) {
      logger.error('Admin OAuth callback: user fetch failed', {
        event: 'admin.login_denied',
        requestId,
        actor: 'admin',
        entity: { type: 'oauth', id: 'github' },
        outcome: 'failure',
        reason: 'user_fetch_failed',
        error: err instanceof Error ? err.message : String(err)
      });
      return c.redirect(`${resolvedDeps.getAppBaseUrl()}/admin?error=user_fetch_failed`);
    }

    // Validate against allowlist (stable numeric GitHub ID)
    const allowedUserId = resolvedDeps.getAllowedGithubUserId();
    const githubId = String(githubUser.id);

    if (githubId !== allowedUserId) {
      logger.warn('Admin OAuth callback: user not allowlisted', {
        event: 'admin.login_denied',
        requestId,
        actor: 'admin',
        entity: { type: 'github_user', id: githubId },
        outcome: 'failure',
        reason: 'not_allowlisted',
        githubLogin: githubUser.login
      });
      return c.redirect(`${resolvedDeps.getAppBaseUrl()}/admin?error=not_allowlisted`);
    }

    // Create admin session
    const now = resolvedDeps.now();
    const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
    const db = resolvedDeps.getDb();

    let sessionId: string;
    try {
      const [session] = await db
        .insert(adminSessions)
        .values({
          githubId,
          githubLogin: githubUser.login,
          expiresAt
        })
        .returning({ id: adminSessions.id });

      if (!session) {
        throw new Error('Session insert returned no rows.');
      }

      sessionId = session.id;
    } catch (err) {
      logger.error('Admin OAuth callback: session creation failed', {
        event: 'admin.login_denied',
        requestId,
        actor: 'admin',
        entity: { type: 'github_user', id: githubId },
        outcome: 'failure',
        reason: 'session_creation_failed',
        error: err instanceof Error ? err.message : String(err)
      });
      return c.redirect(`${resolvedDeps.getAppBaseUrl()}/admin?error=session_creation_failed`);
    }

    const isProduction = resolvedDeps.getAppEnv() === 'production';
    const sessionSecret = resolvedDeps.getSessionSecret();
    const maxAgeSeconds = Math.floor(SESSION_DURATION_MS / 1000);

    await setSignedCookie(c, ADMIN_SESSION_COOKIE_NAME, sessionId, sessionSecret, {
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: maxAgeSeconds,
      ...(isProduction && { secure: true })
    });

    logger.info('Admin login succeeded', {
      event: 'admin.login_succeeded',
      requestId,
      actor: 'admin',
      entity: { type: 'admin_session', id: sessionId },
      outcome: 'success',
      githubId,
      githubLogin: githubUser.login
    });

    return c.redirect(`${resolvedDeps.getAppBaseUrl()}${stateEntry.redirectTo}`);
  });

  // ─── POST /auth/logout ───────────────────────────────────────────────────
  // Revokes the current admin session and clears the cookie.
  router.post('/logout', async (c) => {
    const requestId = getRequestId(c);
    const sessionSecret = resolvedDeps.getSessionSecret();
    const sessionId = await getSignedCookie(c, sessionSecret, ADMIN_SESSION_COOKIE_NAME);

    if (!sessionId) {
      return c.json({ ok: true }, 200);
    }

    try {
      const db = resolvedDeps.getDb();
      const now = resolvedDeps.now();

      await db.update(adminSessions).set({ revokedAt: now }).where(eq(adminSessions.id, sessionId));

      logger.info('Admin session revoked', {
        event: 'admin.session_revoked',
        requestId,
        actor: 'admin',
        entity: { type: 'admin_session', id: sessionId },
        outcome: 'success'
      });
    } catch (err) {
      logger.error('Admin logout: session revocation failed', {
        event: 'admin.session_revocation_failed',
        requestId,
        actor: 'admin',
        entity: { type: 'admin_session', id: sessionId },
        outcome: 'failure',
        error: err instanceof Error ? err.message : String(err)
      });
    }

    deleteCookie(c, ADMIN_SESSION_COOKIE_NAME, { path: '/' });
    return c.json({ ok: true }, 200);
  });

  return router;
}

export const authRouter = createAuthRouter();
