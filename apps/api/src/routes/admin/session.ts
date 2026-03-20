import type { Context } from 'hono';
import { logger } from '../../logger';
import { getRequestId, readCookieValue } from '../support';
import { accessDeniedBody } from './helpers';
import type { ResolvedAdminRouterDeps, SessionRecord } from './types';
import { ADMIN_SESSION_COOKIE_NAME } from './types';

export function getSessionId(c: Context): string | null {
  return (
    c.req.header('x-admin-session-id') ??
    readCookieValue(c.req.header('cookie'), ADMIN_SESSION_COOKIE_NAME)
  );
}

export async function requireAdminSession(
  c: Context,
  deps: ResolvedAdminRouterDeps
): Promise<{ ok: true; session: SessionRecord } | { ok: false; response: Response }> {
  const requestId = getRequestId(c);
  const sessionId = getSessionId(c);

  if (!sessionId) {
    logger.warn('Admin access denied: missing session', {
      event: 'admin_access_denied',
      requestId,
      actor: 'admin',
      entity: { type: 'http_request', id: c.req.path },
      outcome: 'failure',
      reason: 'session_required'
    });
    return { ok: false, response: c.json(accessDeniedBody('session_required'), 401) };
  }

  let session: SessionRecord | null;
  try {
    session = await deps.findSessionById(sessionId);
  } catch (err) {
    logger.error('Admin session lookup failed', {
      event: 'admin_session_lookup_failed',
      requestId,
      actor: 'admin',
      entity: { type: 'admin_session', id: sessionId },
      outcome: 'failure',
      error: err instanceof Error ? err.message : String(err)
    });
    return { ok: false, response: c.json({ error: 'internal_error' }, 500) };
  }

  if (!session || session.revokedAt) {
    logger.warn('Admin access denied: session missing or revoked', {
      event: 'admin_access_denied',
      requestId,
      actor: 'admin',
      entity: { type: 'admin_session', id: sessionId },
      outcome: 'failure',
      reason: 'session_required'
    });
    return { ok: false, response: c.json(accessDeniedBody('session_required'), 401) };
  }

  if (session.expiresAt <= deps.now()) {
    logger.warn('Admin access denied: session expired', {
      event: 'admin_access_denied',
      requestId,
      actor: 'admin',
      entity: { type: 'admin_session', id: session.id },
      outcome: 'failure',
      reason: 'session_expired'
    });
    return { ok: false, response: c.json(accessDeniedBody('session_expired'), 401) };
  }

  if (session.githubId !== deps.getAllowedGithubUserId()) {
    logger.warn('Admin access denied: github user not allowlisted', {
      event: 'admin_access_denied',
      requestId,
      actor: 'admin',
      entity: { type: 'admin_session', id: session.id },
      outcome: 'failure',
      reason: 'not_allowlisted'
    });
    return { ok: false, response: c.json(accessDeniedBody('not_allowlisted'), 403) };
  }

  return { ok: true, session };
}
