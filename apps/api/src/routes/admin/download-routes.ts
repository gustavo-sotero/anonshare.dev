import { downloadEvents } from '@anonshare/infrastructure/db/schema';
import { count, desc, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { logger } from '../../logger';
import { getRequestId } from '../support';
import { requireAdminSession } from './session';
import type { ResolvedAdminRouterDeps } from './types';

export function registerAdminDownloadRoutes(router: Hono, resolvedDeps: ResolvedAdminRouterDeps) {
  router.get('/downloads', async (c) => {
    const auth = await requireAdminSession(c, resolvedDeps);
    if (!auth.ok) return auth.response;

    const requestId = getRequestId(c);
    const fileId = c.req.query('fileId');
    const rawPage = Number(c.req.query('page') || '1');
    const rawPageSize = Number(c.req.query('pageSize') || '50');
    const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
    const pageSize =
      Number.isInteger(rawPageSize) && rawPageSize >= 1 ? Math.min(rawPageSize, 100) : 50;
    const offset = (page - 1) * pageSize;

    try {
      const db = resolvedDeps.getDb();
      const where = fileId ? eq(downloadEvents.fileId, fileId) : undefined;

      const [rows, [totalRow]] = await Promise.all([
        db
          .select({
            id: downloadEvents.id,
            fileId: downloadEvents.fileId,
            eventType: downloadEvents.eventType,
            createdAt: downloadEvents.createdAt,
            ipHash: downloadEvents.ipHash
          })
          .from(downloadEvents)
          .where(where)
          .orderBy(desc(downloadEvents.createdAt))
          .limit(pageSize)
          .offset(offset),
        db.select({ total: count() }).from(downloadEvents).where(where)
      ]);

      return c.json(
        {
          downloads: rows.map((d) => ({
            id: d.id,
            fileId: d.fileId,
            eventType: d.eventType,
            createdAt: d.createdAt.toISOString(),
            ipHash: d.ipHash
          })),
          total: totalRow?.total ?? 0,
          page,
          pageSize
        },
        200
      );
    } catch (err) {
      logger.error('Admin downloads list failed', {
        event: 'admin_downloads_list_failed',
        requestId,
        actor: 'admin',
        entity: { type: 'http_request', id: c.req.path },
        outcome: 'failure',
        error: err instanceof Error ? err.message : String(err)
      });
      return c.json({ error: 'internal_error' }, 500);
    }
  });
}
