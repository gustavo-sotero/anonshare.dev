import { adminReportListQuerySchema, resolveReportSchema } from '@anonshare/contracts';
import { reports } from '@anonshare/infrastructure/db/schema';
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import type { Hono } from 'hono';
import { logger } from '../../logger';
import { getRequestId } from '../support';
import { getReportUrgency, getReportUrgencyReasonFilter } from './helpers';
import { requireAdminSession } from './session';
import type { ResolvedAdminRouterDeps } from './types';

export function registerAdminReportRoutes(router: Hono, resolvedDeps: ResolvedAdminRouterDeps) {
  router.get('/reports', async (c) => {
    const auth = await requireAdminSession(c, resolvedDeps);
    if (!auth.ok) return auth.response;

    const requestId = getRequestId(c);

    const queryParsed = adminReportListQuerySchema.safeParse({
      status: c.req.query('status'),
      fileId: c.req.query('fileId'),
      reason: c.req.query('reason'),
      urgency: c.req.query('urgency'),
      cursor: c.req.query('cursor'),
      pageSize: c.req.query('pageSize')
    });

    if (!queryParsed.success) {
      return c.json(
        { ok: false, error: { code: 'validation_error', message: 'Invalid query parameters.' } },
        400
      );
    }

    const { status, fileId, reason, urgency, cursor, pageSize } = queryParsed.data;

    try {
      const db = resolvedDeps.getDb();
      let where = status ? eq(reports.status, status) : undefined;

      if (fileId) {
        const fileIdCondition = eq(reports.fileId, fileId);
        where = where ? and(where, fileIdCondition) : fileIdCondition;
      }

      if (reason) {
        const reasonCondition = eq(reports.reason, reason);
        where = where ? and(where, reasonCondition) : reasonCondition;
      }

      if (urgency) {
        const urgencyCondition = inArray(reports.reason, getReportUrgencyReasonFilter(urgency));
        where = where ? and(where, urgencyCondition) : urgencyCondition;
      }

      // Decode and apply cursor for keyset pagination (reports sorted by createdAt DESC).
      if (cursor) {
        try {
          const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8')) as {
            s: unknown;
            i: unknown;
          };
          if (typeof decoded.s === 'string' && typeof decoded.i === 'string') {
            const cursorDate = new Date(decoded.s);
            const cursorCondition = or(
              lt(reports.createdAt, cursorDate),
              and(eq(reports.createdAt, cursorDate), lt(reports.id, decoded.i))
            );
            where = where ? and(where, cursorCondition) : cursorCondition;
          }
        } catch {
          // Malformed cursor — ignore and return first page.
        }
      }

      // Fetch one extra row to determine whether a next page exists.
      const rows = await db
        .select()
        .from(reports)
        .where(where)
        .orderBy(desc(reports.createdAt))
        .limit(pageSize + 1);

      const hasMore = rows.length > pageSize;
      const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
      const lastRow = pageRows[pageRows.length - 1];

      let nextCursor: string | null = null;
      if (hasMore && lastRow) {
        nextCursor = Buffer.from(
          JSON.stringify({ s: lastRow.createdAt.toISOString(), i: lastRow.id })
        ).toString('base64url');
      }

      return c.json(
        {
          reports: pageRows.map((r) => ({
            id: r.id,
            fileId: r.fileId,
            reason: r.reason,
            urgency: getReportUrgency(r.reason),
            message: r.message,
            status: r.status,
            resolvedBy: r.resolvedBy,
            resolvedAt: r.resolvedAt?.toISOString() ?? null,
            createdAt: r.createdAt.toISOString()
          })),
          nextCursor,
          hasMore
        },
        200
      );
    } catch (err) {
      logger.error('Admin reports list failed', {
        event: 'admin_reports_list_failed',
        requestId,
        actor: 'admin',
        entity: { type: 'http_request', id: c.req.path },
        outcome: 'failure',
        error: err instanceof Error ? err.message : String(err)
      });
      return c.json({ error: 'internal_error' }, 500);
    }
  });

  router.post('/reports/:id/resolve', async (c) => {
    const auth = await requireAdminSession(c, resolvedDeps);
    if (!auth.ok) return auth.response;

    const requestId = getRequestId(c);
    const reportId = c.req.param('id');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { ok: false, error: { code: 'validation_error', message: 'Request body must be JSON.' } },
        400
      );
    }

    const parsedBody = resolveReportSchema.safeParse(body);
    if (!parsedBody.success) {
      return c.json(
        { ok: false, error: { code: 'validation_error', message: 'Invalid resolution action.' } },
        400
      );
    }

    const { action } = parsedBody.data;
    const resolverLogin = auth.session.githubLogin;

    try {
      const db = resolvedDeps.getDb();
      const now = resolvedDeps.now();

      const report = await db.query.reports.findFirst({ where: eq(reports.id, reportId) });
      if (!report) {
        return c.json(
          { ok: false, error: { code: 'not_found', message: 'Report not found.' } },
          404
        );
      }

      if (report.status !== 'pending') {
        return c.json(
          { ok: false, error: { code: 'conflict', message: 'Report has already been resolved.' } },
          409
        );
      }

      await db
        .update(reports)
        .set({
          status: action,
          resolvedBy: resolverLogin,
          resolvedAt: now
        })
        .where(eq(reports.id, reportId));

      logger.info('Report resolved', {
        event: action === 'resolved' ? 'admin.report_resolved' : 'admin.report_dismissed',
        requestId,
        actor: 'admin',
        entity: { type: 'report', id: reportId },
        outcome: 'success',
        fileId: report.fileId,
        action,
        resolvedBy: resolverLogin
      });

      return c.json(
        {
          ok: true as const,
          data: { reportId, status: action, resolvedAt: now.toISOString() }
        },
        200
      );
    } catch (err) {
      logger.error('Admin report resolve failed', {
        event: 'admin_report_resolve_failed',
        requestId,
        actor: 'admin',
        entity: { type: 'report', id: reportId },
        outcome: 'failure',
        error: err instanceof Error ? err.message : String(err)
      });
      return c.json({ error: 'internal_error' }, 500);
    }
  });
}
