import { app as appConfig, auth as authConfig } from '@anonshare/infrastructure/config';
import { createDb } from '@anonshare/infrastructure/db';
import { adminSessions, files } from '@anonshare/infrastructure/db/schema';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { setSignedCookie } from 'hono/cookie';
import { ADMIN_SESSION_COOKIE_NAME } from './admin/types';

// Internal endpoints used by the worker (not public-facing)
export const internalRouter = new Hono();

internalRouter.post('/expire/:fileId', (c) => c.json({ error: 'not_implemented' }, 501));
internalRouter.post('/cleanup/:fileId', (c) => c.json({ error: 'not_implemented' }, 501));

/**
 * Test-only: force-expire a file by setting its expiresAt to its uploadedAt timestamp.
 *
 * This makes isExpiredByTimestamp() return true immediately (expiresAt <= now),
 * while satisfying the DB constraint (expiresAt >= uploadedAt).
 * Guarded by APP_ENV === 'test' — absent in production.
 */
internalRouter.post('/test/expire/:token', async (c) => {
  if (appConfig.env() !== 'test') {
    return c.json({ error: 'not_found' }, 404);
  }

  const { token } = c.req.param();

  let db: ReturnType<typeof createDb>;
  try {
    db = createDb();
  } catch {
    return c.json({ error: 'db_unavailable' }, 503);
  }

  // Single atomic UPDATE: set expiresAt = uploadedAt (a past timestamp that satisfies
  // the DB constraint expiresAt >= uploadedAt). isExpiredByTimestamp() then returns true
  // because expiresAt (= uploadedAt) <= now() for any active or expiring file.
  const [updated] = await db
    .update(files)
    .set({ expiresAt: sql`${files.uploadedAt}` })
    .where(eq(files.token, token))
    .returning({ id: files.id });

  if (!updated) {
    return c.json({ error: 'not_found' }, 404);
  }

  return c.json({ ok: true }, 200);
});

/**
 * Test-only: create an admin session without GitHub OAuth.
 *
 * This route is mounted ONLY when APP_ENV (NODE_ENV) is 'test'. It enables
 * Playwright E2E tests to bootstrap an admin session in CI without requiring a
 * real GitHub OAuth round-trip.
 *
 * The endpoint is completely absent in production because the handler returns
 * 404 before touching any state. Do NOT use NODE_ENV=test in production.
 */
internalRouter.post('/test/session', async (c) => {
  if (appConfig.env() !== 'test') {
    return c.json({ error: 'not_found' }, 404);
  }

  const githubId = authConfig.githubAllowedUserId();
  const githubLogin = process.env.E2E_ADMIN_GITHUB_LOGIN ?? 'e2e-admin';
  const sessionSecret = authConfig.sessionSecret();
  const sessionDurationMs = 60 * 60 * 1000; // 1 hour is sufficient for a test run

  let db: ReturnType<typeof createDb>;
  try {
    db = createDb();
  } catch {
    return c.json({ error: 'db_unavailable' }, 503);
  }

  const expiresAt = new Date(Date.now() + sessionDurationMs);

  const [session] = await db
    .insert(adminSessions)
    .values({ githubId, githubLogin, expiresAt })
    .returning({ id: adminSessions.id });

  if (!session) {
    return c.json({ error: 'session_create_failed' }, 500);
  }

  const isProduction = false; // Never true: production rejects this route above
  await setSignedCookie(c, ADMIN_SESSION_COOKIE_NAME, session.id, sessionSecret, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: isProduction,
    maxAge: Math.floor(sessionDurationMs / 1000)
  });

  return c.json({ ok: true, sessionId: session.id }, 200);
});
