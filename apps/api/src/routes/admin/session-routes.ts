import type { Hono } from 'hono';
import { logger } from '../../logger';
import { getRequestId } from '../support';
import { getSessionId } from './session';
import type { ResolvedAdminRouterDeps } from './types';

export function registerAdminSessionRoutes(router: Hono, resolvedDeps: ResolvedAdminRouterDeps) {
  router.get('/session', async (c) => {
    const sessionId = await getSessionId(c, resolvedDeps.getSessionSecret());

    if (!sessionId) {
      return c.json({ authenticated: false, session: null }, 200);
    }

    try {
      const session = await resolvedDeps.findSessionById(sessionId);

      if (
        !session ||
        session.revokedAt ||
        session.expiresAt <= resolvedDeps.now() ||
        session.githubId !== resolvedDeps.getAllowedGithubUserId()
      ) {
        return c.json({ authenticated: false, session: null }, 200);
      }

      return c.json(
        {
          authenticated: true,
          session: {
            id: session.id,
            githubId: session.githubId,
            githubLogin: session.githubLogin,
            expiresAt: session.expiresAt.toISOString()
          }
        },
        200
      );
    } catch (err) {
      logger.error('Admin session endpoint failed', {
        event: 'admin_session_lookup_failed',
        requestId: getRequestId(c),
        actor: 'admin',
        entity: { type: 'admin_session', id: sessionId },
        outcome: 'failure',
        error: err instanceof Error ? err.message : String(err)
      });
      return c.json({ error: 'internal_error' }, 500);
    }
  });
}
