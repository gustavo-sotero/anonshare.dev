import {
  adminFileListQuerySchema,
  adminReportListQuerySchema,
  moderationActionSchema,
  resolveReportSchema
} from '@anonshare/contracts';
import { auth as authConfig } from '@anonshare/infrastructure/config';
import {
  downloadEvents,
  fileModerationActions,
  files,
  reports
} from '@anonshare/infrastructure/db/schema';
import { storageAdapter } from '@anonshare/infrastructure/storage';
import { and, count, desc, eq, gte, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { logger } from '../../logger';
import { getDb as getDbShared, getRequestId } from '../support';
import {
  buildDailySeries,
  clampAnomalyLimit,
  getAnomalySeverity,
  getReportUrgency,
  getReportUrgencyReasonFilter,
  normalizeAnomalyDetails,
  resolveRestoredFileStatus,
  setNoStoreHeaders,
  startOfUtcDay
} from './helpers';
import {
  defaultFindSessionById,
  defaultGetDownloadCounts,
  defaultGetQueues,
  defaultListAnomalies,
  defaultListAutoHiddenCountsByDay,
  defaultListDismissedReportCountsByDay,
  defaultListFileStatusCounts,
  defaultListOpenAnomalyCounts,
  defaultListRateLimitBlockedCountsByDay,
  defaultListReportCountsByDay,
  defaultListReportStatusCounts,
  defaultListResolvedReportCountsByDay,
  enqueueCleanupFileJob
} from './queries';
import { buildQueueHealthSnapshot } from './queue-health';
import { getSessionId, requireAdminSession } from './session';
import type { AdminRouterDeps } from './types';
import {
  ABUSE_METRICS_WINDOW_DAYS,
  DAY_IN_MS,
  FILE_DETAIL_MODERATION_HISTORY_LIMIT,
  FILE_DETAIL_REPORT_LIMIT
} from './types';

export function createAdminRouter(deps: AdminRouterDeps = {}): Hono {
  const resolvedDeps: Required<AdminRouterDeps> = {
    findSessionById: deps.findSessionById ?? defaultFindSessionById,
    listAnomalies: deps.listAnomalies ?? defaultListAnomalies,
    listOpenAnomalyCounts: deps.listOpenAnomalyCounts ?? defaultListOpenAnomalyCounts,
    listReportStatusCounts: deps.listReportStatusCounts ?? defaultListReportStatusCounts,
    listReportCountsByDay: deps.listReportCountsByDay ?? defaultListReportCountsByDay,
    listAutoHiddenCountsByDay: deps.listAutoHiddenCountsByDay ?? defaultListAutoHiddenCountsByDay,
    listResolvedReportCountsByDay:
      deps.listResolvedReportCountsByDay ?? defaultListResolvedReportCountsByDay,
    listDismissedReportCountsByDay:
      deps.listDismissedReportCountsByDay ?? defaultListDismissedReportCountsByDay,
    listRateLimitBlockedCountsByDay:
      deps.listRateLimitBlockedCountsByDay ?? defaultListRateLimitBlockedCountsByDay,
    listFileStatusCounts: deps.listFileStatusCounts ?? defaultListFileStatusCounts,
    getDownloadCounts: deps.getDownloadCounts ?? defaultGetDownloadCounts,
    getAllowedGithubUserId: deps.getAllowedGithubUserId ?? authConfig.githubAllowedUserId,
    getQueues: deps.getQueues ?? defaultGetQueues,
    headStorageObject: deps.headStorageObject ?? storageAdapter.head,
    now: deps.now ?? (() => new Date()),
    enqueueCleanupFile: deps.enqueueCleanupFile ?? enqueueCleanupFileJob,
    getDb: deps.getDb ?? getDbShared
  };

  const router = new Hono();

  router.use('*', async (c, next) => {
    setNoStoreHeaders(c);
    await next();
  });

  router.get('/session', async (c) => {
    const sessionId = getSessionId(c);

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

  // ─── GET /overview ───────────────────────────────────────────────────────
  router.get('/overview', async (c) => {
    const auth = await requireAdminSession(c, resolvedDeps);
    if (!auth.ok) return auth.response;

    const requestId = getRequestId(c);

    try {
      const [fileStatusCounts, downloadCounts] = await Promise.all([
        resolvedDeps.listFileStatusCounts(),
        resolvedDeps.getDownloadCounts()
      ]);

      const byStatus: Record<string, number> = {};
      let totalFiles = 0;
      let totalStorageBytes = 0;

      for (const row of fileStatusCounts) {
        byStatus[row.status] = row.count;
        totalFiles += row.count;
        totalStorageBytes += Number(row.totalSizeBytes);
      }

      return c.json(
        {
          totalFiles,
          byStatus,
          totalStorageBytes,
          totalDownloads: downloadCounts.totalDownloads
        },
        200
      );
    } catch (err) {
      logger.error('Admin overview query failed', {
        event: 'admin_overview_query_failed',
        requestId,
        actor: 'admin',
        entity: { type: 'http_request', id: c.req.path },
        outcome: 'failure',
        error: err instanceof Error ? err.message : String(err)
      });
      return c.json({ error: 'internal_error' }, 500);
    }
  });

  router.get('/anomalies', async (c) => {
    const auth = await requireAdminSession(c, resolvedDeps);
    if (!auth.ok) {
      return auth.response;
    }

    try {
      const anomalies = await resolvedDeps.listAnomalies(clampAnomalyLimit(c.req.query('limit')));

      return c.json(
        {
          anomalies: anomalies.map((anomaly) => {
            const details = normalizeAnomalyDetails(anomaly.details);

            return {
              id: anomaly.id,
              type: anomaly.type,
              severity: getAnomalySeverity(anomaly.type, details),
              fileId: anomaly.fileId,
              details,
              detectedAt: anomaly.detectedAt.toISOString(),
              resolvedAt: anomaly.resolvedAt?.toISOString() ?? null,
              resolution: anomaly.resolution
            };
          })
        },
        200
      );
    } catch (err) {
      logger.error('Admin anomalies query failed', {
        event: 'admin_anomalies_query_failed',
        requestId: getRequestId(c),
        actor: 'admin',
        entity: { type: 'http_request', id: c.req.path },
        outcome: 'failure',
        error: err instanceof Error ? err.message : String(err)
      });
      return c.json({ error: 'internal_error' }, 500);
    }
  });

  router.get('/stats', async (c) => {
    const auth = await requireAdminSession(c, resolvedDeps);
    if (!auth.ok) {
      return auth.response;
    }

    try {
      const now = resolvedDeps.now();
      const nowMs = now.getTime();
      const metricsStart = startOfUtcDay(now);
      metricsStart.setUTCDate(metricsStart.getUTCDate() - (ABUSE_METRICS_WINDOW_DAYS - 1));
      const requestId = getRequestId(c);
      const [
        anomalyCounts,
        queueHealth,
        reportStatusCounts,
        reportCountsByDay,
        autoHiddenCountsByDay,
        resolvedReportCountsByDay,
        dismissedReportCountsByDay,
        rateLimitBlockedCountsByDay
      ] = await Promise.all([
        resolvedDeps.listOpenAnomalyCounts(),
        Promise.all(
          resolvedDeps.getQueues().map((queue) => buildQueueHealthSnapshot(queue, nowMs, requestId))
        ),
        resolvedDeps.listReportStatusCounts(),
        resolvedDeps.listReportCountsByDay(metricsStart),
        resolvedDeps.listAutoHiddenCountsByDay(metricsStart),
        resolvedDeps.listResolvedReportCountsByDay(metricsStart),
        resolvedDeps.listDismissedReportCountsByDay(metricsStart),
        resolvedDeps
          .listRateLimitBlockedCountsByDay(metricsStart, ABUSE_METRICS_WINDOW_DAYS)
          .catch((err) => {
            logger.warn('Admin rate-limit metrics degraded', {
              event: 'admin_rate_limit_metrics_degraded',
              requestId,
              actor: 'admin',
              entity: { type: 'http_request', id: c.req.path },
              outcome: 'failure',
              error: err instanceof Error ? err.message : String(err)
            });

            return [];
          })
      ]);

      const openAnomaliesByType = Object.fromEntries(
        anomalyCounts.map((row) => [row.type, row.count])
      );
      const openAnomaliesTotal = anomalyCounts.reduce((sum, row) => sum + row.count, 0);

      const reportTotals = {
        total: 0,
        byStatus: {
          pending: 0,
          resolved: 0,
          dismissed: 0
        }
      };

      for (const row of reportStatusCounts) {
        reportTotals.total += row.count;
        if (row.status === 'pending' || row.status === 'resolved' || row.status === 'dismissed') {
          reportTotals.byStatus[row.status] = row.count;
        }
      }

      const abuseMetrics = {
        windowDays: ABUSE_METRICS_WINDOW_DAYS,
        reportsByDay: buildDailySeries(reportCountsByDay, metricsStart, ABUSE_METRICS_WINDOW_DAYS),
        autoHiddenByDay: buildDailySeries(
          autoHiddenCountsByDay,
          metricsStart,
          ABUSE_METRICS_WINDOW_DAYS
        ),
        resolvedReportsByDay: buildDailySeries(
          resolvedReportCountsByDay,
          metricsStart,
          ABUSE_METRICS_WINDOW_DAYS
        ),
        dismissedReportsByDay: buildDailySeries(
          dismissedReportCountsByDay,
          metricsStart,
          ABUSE_METRICS_WINDOW_DAYS
        ),
        rateLimitBlockedByDay: buildDailySeries(
          rateLimitBlockedCountsByDay,
          metricsStart,
          ABUSE_METRICS_WINDOW_DAYS
        )
      };

      return c.json(
        {
          openAnomaliesTotal,
          openAnomaliesByType,
          reportTotals,
          abuseMetrics,
          queueHealth
        },
        200
      );
    } catch (err) {
      logger.error('Admin lifecycle stats query failed', {
        event: 'admin_lifecycle_stats_query_failed',
        requestId: getRequestId(c),
        actor: 'admin',
        entity: { type: 'http_request', id: c.req.path },
        outcome: 'failure',
        error: err instanceof Error ? err.message : String(err)
      });
      return c.json({ error: 'internal_error' }, 500);
    }
  });

  router.get('/files', async (c) => {
    const auth = await requireAdminSession(c, resolvedDeps);
    if (!auth.ok) return auth.response;

    const requestId = getRequestId(c);

    const queryParsed = adminFileListQuerySchema.safeParse({
      status: c.req.query('status'),
      policy: c.req.query('policy'),
      sortBy: c.req.query('sortBy'),
      uploadedWithinDays: c.req.query('uploadedWithinDays'),
      minReportCount: c.req.query('minReportCount'),
      page: c.req.query('page'),
      pageSize: c.req.query('pageSize')
    });

    if (!queryParsed.success) {
      return c.json(
        { ok: false, error: { code: 'validation_error', message: 'Invalid query parameters.' } },
        400
      );
    }

    const { status, policy, sortBy, uploadedWithinDays, minReportCount, page, pageSize } =
      queryParsed.data;
    const offset = (page - 1) * pageSize;

    const orderByClause =
      sortBy === 'sizeBytes_desc'
        ? desc(files.sizeBytes)
        : sortBy === 'reportCount_desc'
          ? desc(files.reportCount)
          : desc(files.uploadedAt);

    try {
      const db = resolvedDeps.getDb();
      let where = status ? eq(files.status, status) : undefined;

      if (policy === 'one_time') {
        const oneTimeCondition = eq(files.oneTimeDownload, true);
        where = where ? and(where, oneTimeCondition) : oneTimeCondition;
      }

      if (policy === 'preview_enabled') {
        const previewCondition = eq(files.allowPreview, true);
        where = where ? and(where, previewCondition) : previewCondition;
      }

      if (policy === 'standard') {
        const standardPolicyCondition = and(
          eq(files.oneTimeDownload, false),
          eq(files.allowPreview, false)
        );
        where = where ? and(where, standardPolicyCondition) : standardPolicyCondition;
      }

      if (uploadedWithinDays !== undefined) {
        const uploadedAfter = new Date(
          resolvedDeps.now().getTime() - uploadedWithinDays * DAY_IN_MS
        );
        const uploadedAfterCondition = gte(files.uploadedAt, uploadedAfter);
        where = where ? and(where, uploadedAfterCondition) : uploadedAfterCondition;
      }

      if (minReportCount !== undefined) {
        const minReportCountCondition = gte(files.reportCount, minReportCount);
        where = where ? and(where, minReportCountCondition) : minReportCountCondition;
      }

      const [rows, [totalRow]] = await Promise.all([
        db.select().from(files).where(where).orderBy(orderByClause).limit(pageSize).offset(offset),
        db.select({ total: count() }).from(files).where(where)
      ]);

      return c.json(
        {
          files: rows.map((f) => ({
            id: f.id,
            token: f.token,
            sanitizedFilename: f.sanitizedFilename,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
            status: f.status,
            reportCount: f.reportCount,
            allowPreview: f.allowPreview,
            oneTimeDownload: f.oneTimeDownload,
            expiresAt: f.expiresAt?.toISOString() ?? null,
            uploadedAt: f.uploadedAt.toISOString(),
            activatedAt: f.activatedAt?.toISOString() ?? null,
            consumedAt: f.consumedAt?.toISOString() ?? null,
            deletedAt: f.deletedAt?.toISOString() ?? null
          })),
          total: totalRow?.total ?? 0,
          page,
          pageSize
        },
        200
      );
    } catch (err) {
      logger.error('Admin files list failed', {
        event: 'admin_files_list_failed',
        requestId,
        actor: 'admin',
        entity: { type: 'http_request', id: c.req.path },
        outcome: 'failure',
        error: err instanceof Error ? err.message : String(err)
      });
      return c.json({ error: 'internal_error' }, 500);
    }
  });

  router.get('/files/:id', async (c) => {
    const auth = await requireAdminSession(c, resolvedDeps);
    if (!auth.ok) return auth.response;

    const requestId = getRequestId(c);
    const fileId = c.req.param('id');

    try {
      const db = resolvedDeps.getDb();

      const file = await db.query.files.findFirst({ where: eq(files.id, fileId) });
      if (!file) {
        return c.json({ ok: false, error: { code: 'not_found', message: 'File not found.' } }, 404);
      }

      const storageCheckedAt = resolvedDeps.now();

      const [fileReports, moderationHistory, recentDownloadEvents, [downloadTotalsRow]] =
        await Promise.all([
          db
            .select()
            .from(reports)
            .where(eq(reports.fileId, fileId))
            .orderBy(desc(reports.createdAt))
            .limit(FILE_DETAIL_REPORT_LIMIT),
          db
            .select()
            .from(fileModerationActions)
            .where(eq(fileModerationActions.fileId, fileId))
            .orderBy(desc(fileModerationActions.createdAt))
            .limit(FILE_DETAIL_MODERATION_HISTORY_LIMIT),
          db
            .select({
              id: downloadEvents.id,
              fileId: downloadEvents.fileId,
              eventType: downloadEvents.eventType,
              createdAt: downloadEvents.createdAt,
              ipHash: downloadEvents.ipHash
            })
            .from(downloadEvents)
            .where(eq(downloadEvents.fileId, fileId))
            .orderBy(desc(downloadEvents.createdAt))
            .limit(10),
          db
            .select({ total: count() })
            .from(downloadEvents)
            .where(eq(downloadEvents.fileId, fileId))
        ]);

      let storageObject: {
        objectKey: string;
        status: 'present' | 'missing' | 'unknown';
        contentLength: number | null;
        contentType: string | null;
        checkedAt: string;
        error: string | null;
      };

      try {
        const storageHead = await resolvedDeps.headStorageObject(file.objectKey);

        storageObject = {
          objectKey: file.objectKey,
          status: storageHead ? 'present' : 'missing',
          contentLength: storageHead?.contentLength ?? null,
          contentType: storageHead?.contentType ?? null,
          checkedAt: storageCheckedAt.toISOString(),
          error: null
        };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);

        logger.warn('Admin file storage inspection degraded', {
          event: 'admin_file_storage_inspection_degraded',
          requestId,
          actor: 'admin',
          entity: { type: 'file', id: fileId },
          outcome: 'failure',
          objectKey: file.objectKey,
          error
        });

        storageObject = {
          objectKey: file.objectKey,
          status: 'unknown',
          contentLength: null,
          contentType: null,
          checkedAt: storageCheckedAt.toISOString(),
          error
        };
      }

      return c.json(
        {
          file: {
            id: file.id,
            token: file.token,
            sanitizedFilename: file.sanitizedFilename,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            status: file.status,
            reportCount: file.reportCount,
            allowPreview: file.allowPreview,
            oneTimeDownload: file.oneTimeDownload,
            expiresAt: file.expiresAt?.toISOString() ?? null,
            uploadedAt: file.uploadedAt.toISOString(),
            activatedAt: file.activatedAt?.toISOString() ?? null,
            consumedAt: file.consumedAt?.toISOString() ?? null,
            deletedAt: file.deletedAt?.toISOString() ?? null,
            storageObject,
            downloadActivity: {
              total: downloadTotalsRow?.total ?? 0,
              recent: recentDownloadEvents.map((event) => ({
                id: event.id,
                fileId: event.fileId,
                eventType: event.eventType,
                createdAt: event.createdAt.toISOString(),
                ipHash: event.ipHash
              }))
            },
            reports: fileReports.map((r) => ({
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
            moderationHistory: moderationHistory.map((m) => ({
              id: m.id,
              action: m.action,
              previousStatus: m.previousStatus,
              nextStatus: m.nextStatus,
              actorGithubLogin: m.actorGithubLogin,
              reason: m.reason,
              createdAt: m.createdAt.toISOString()
            }))
          }
        },
        200
      );
    } catch (err) {
      logger.error('Admin file detail failed', {
        event: 'admin_file_detail_failed',
        requestId,
        actor: 'admin',
        entity: { type: 'file', id: fileId },
        outcome: 'failure',
        error: err instanceof Error ? err.message : String(err)
      });
      return c.json({ error: 'internal_error' }, 500);
    }
  });

  router.post('/files/:id/moderate', async (c) => {
    const auth = await requireAdminSession(c, resolvedDeps);
    if (!auth.ok) return auth.response;

    const requestId = getRequestId(c);
    const fileId = c.req.param('id');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { ok: false, error: { code: 'validation_error', message: 'Request body must be JSON.' } },
        400
      );
    }

    const parsedBody = moderationActionSchema.safeParse(body);
    if (!parsedBody.success) {
      return c.json(
        { ok: false, error: { code: 'validation_error', message: 'Invalid moderation action.' } },
        400
      );
    }

    const { action, reason } = parsedBody.data;

    const actorGithubId = auth.session.githubId;
    const actorGithubLogin = auth.session.githubLogin;

    try {
      const db = resolvedDeps.getDb();
      const now = resolvedDeps.now();

      const file = await db.query.files.findFirst({ where: eq(files.id, fileId) });
      if (!file) {
        return c.json({ ok: false, error: { code: 'not_found', message: 'File not found.' } }, 404);
      }

      let nextStatus: typeof file.status;
      let latestHiddenPreviousStatus: typeof file.status | null = null;

      if (action === 'hide') {
        if (file.status === 'hidden') {
          return c.json(
            { ok: false, error: { code: 'conflict', message: 'File is already hidden.' } },
            409
          );
        }
        if (file.status === 'deleted') {
          return c.json(
            { ok: false, error: { code: 'conflict', message: 'Cannot hide a deleted file.' } },
            409
          );
        }
        if (file.status !== 'active' && file.status !== 'expiring') {
          return c.json(
            {
              ok: false,
              error: {
                code: 'conflict',
                message: 'Only active or expiring files can be hidden.'
              }
            },
            409
          );
        }
        nextStatus = 'hidden';
      } else if (action === 'restore') {
        if (file.status !== 'hidden') {
          return c.json(
            {
              ok: false,
              error: { code: 'conflict', message: 'Only hidden files can be restored.' }
            },
            409
          );
        }

        const [latestHideAction] = await db
          .select({ previousStatus: fileModerationActions.previousStatus })
          .from(fileModerationActions)
          .where(
            and(
              eq(fileModerationActions.fileId, fileId),
              eq(fileModerationActions.nextStatus, 'hidden')
            )
          )
          .orderBy(desc(fileModerationActions.createdAt))
          .limit(1);

        latestHiddenPreviousStatus = latestHideAction?.previousStatus ?? null;
        nextStatus = resolveRestoredFileStatus({
          file,
          latestHiddenPreviousStatus,
          now
        });
      } else {
        // delete
        if (file.status === 'deleted') {
          return c.json(
            { ok: false, error: { code: 'conflict', message: 'File is already deleted.' } },
            409
          );
        }
        nextStatus = 'deleted';
      }

      const previousStatus = file.status;

      await db.transaction(async (tx) => {
        const updateSet: Partial<typeof files.$inferInsert> = { status: nextStatus };
        if (nextStatus === 'deleted') {
          updateSet.deletedAt = now;
        }

        await tx.update(files).set(updateSet).where(eq(files.id, fileId));

        await tx.insert(fileModerationActions).values({
          fileId,
          action,
          previousStatus,
          nextStatus,
          actorGithubId,
          actorGithubLogin,
          reason: reason ?? null,
          createdAt: now
        });
      });

      logger.info('Admin moderation action applied', {
        event:
          action === 'hide'
            ? 'file.hidden'
            : action === 'restore'
              ? 'admin.file_restored'
              : 'file.deleted',
        requestId,
        actor: 'admin',
        entity: { type: 'file', id: fileId },
        outcome: 'success',
        action,
        trigger: action === 'restore' ? 'manual_restore' : 'manual',
        previousStatus,
        nextStatus,
        restoredFrom: latestHiddenPreviousStatus
      });

      if (nextStatus === 'deleted' || nextStatus === 'expired') {
        resolvedDeps.enqueueCleanupFile(fileId, file.objectKey).catch((err) => {
          logger.warn('Admin moderation: cleanup enqueue failed (reconciler will repair)', {
            event: 'admin_cleanup_enqueue_failed',
            requestId,
            actor: 'admin',
            entity: { type: 'file', id: fileId },
            outcome: 'failure',
            reason: nextStatus === 'expired' ? 'restored_to_expired' : 'deleted',
            error: err instanceof Error ? err.message : String(err)
          });
        });
      }

      return c.json(
        {
          ok: true as const,
          data: { fileId, previousStatus, nextStatus }
        },
        200
      );
    } catch (err) {
      logger.error('Admin moderation action failed', {
        event: 'admin_moderation_action_failed',
        requestId,
        actor: 'admin',
        entity: { type: 'file', id: fileId },
        outcome: 'failure',
        error: err instanceof Error ? err.message : String(err)
      });
      return c.json({ error: 'internal_error' }, 500);
    }
  });

  router.get('/reports', async (c) => {
    const auth = await requireAdminSession(c, resolvedDeps);
    if (!auth.ok) return auth.response;

    const requestId = getRequestId(c);

    const queryParsed = adminReportListQuerySchema.safeParse({
      status: c.req.query('status'),
      fileId: c.req.query('fileId'),
      reason: c.req.query('reason'),
      urgency: c.req.query('urgency'),
      page: c.req.query('page'),
      pageSize: c.req.query('pageSize')
    });

    if (!queryParsed.success) {
      return c.json(
        { ok: false, error: { code: 'validation_error', message: 'Invalid query parameters.' } },
        400
      );
    }

    const { status, fileId, reason, urgency, page, pageSize } = queryParsed.data;
    const offset = (page - 1) * pageSize;

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

      const [rows, [totalRow]] = await Promise.all([
        db
          .select()
          .from(reports)
          .where(where)
          .orderBy(desc(reports.createdAt))
          .limit(pageSize)
          .offset(offset),
        db.select({ total: count() }).from(reports).where(where)
      ]);

      return c.json(
        {
          reports: rows.map((r) => ({
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
          total: totalRow?.total ?? 0,
          page,
          pageSize
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

  // ─── GET /downloads ──────────────────────────────────────────────────────
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

  return router;
}

export type { AdminRouterDeps } from './types';
export const adminRouter = createAdminRouter();
