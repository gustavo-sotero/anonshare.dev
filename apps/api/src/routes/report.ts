import { API_ERROR_CODES, reportRequestSchema } from '@anonshare/contracts';
import { loadSystemSettingOrDefault } from '@anonshare/infrastructure/config';
import type { createDb } from '@anonshare/infrastructure/db';
import { fileModerationActions, files, reports } from '@anonshare/infrastructure/db/schema';
import { applyRateLimit, recordRateLimitBlocked } from '@anonshare/infrastructure/rate-limit';
import type { Redis } from '@anonshare/infrastructure/redis';
import { getRedisClient } from '@anonshare/infrastructure/redis';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { logger } from '../logger';
import {
  errorBody,
  getRequestId,
  hashIp,
  parseShareToken,
  recordBlockedMetricBestEffort,
  getDb as sharedGetDb
} from './support';

// ─── Constants ────────────────────────────────────────────────────────────────
const REPORT_RATE_WINDOW_SECONDS = 3600;

/** Per-IP per-file limit to prevent spam on a specific file. */
const REPORT_PER_FILE_RATE_LIMIT = 3;

// ─── Statuses that block report submission ────────────────────────────────────
const HIDDEN_STATUSES = new Set(['hidden', 'deleted']);
const UNREPORTABLE_STATUSES = new Set(['pending_upload', 'missing']);

const getDb = sharedGetDb;

// ─── Types (injectable for tests) ────────────────────────────────────────────
export type ReportRouterDeps = {
  getDb?: () => ReturnType<typeof createDb>;
  getRedis?: () => Redis;
  now?: () => Date;
  loadReportRateLimit?: () => Promise<number>;
  loadAutoHideThreshold?: () => Promise<number>;
};

// ─── Router factory ───────────────────────────────────────────────────────────

export function createReportRouter(deps: ReportRouterDeps = {}): Hono {
  const resolvedDeps = {
    getDb: deps.getDb ?? getDb,
    getRedis: deps.getRedis ?? getRedisClient,
    now: deps.now ?? (() => new Date()),
    loadReportRateLimit:
      deps.loadReportRateLimit ??
      (() => loadSystemSettingOrDefault((deps.getDb ?? getDb)(), 'reportRateLimitPerHour')),
    loadAutoHideThreshold:
      deps.loadAutoHideThreshold ??
      (() => loadSystemSettingOrDefault((deps.getDb ?? getDb)(), 'reportAutoHideThreshold'))
  };

  const router = new Hono();

  router.post('/:token', async (c) => {
    c.header('cache-control', 'no-store');
    const requestId = getRequestId(c);

    const token = parseShareToken(c.req.param('token'));
    if (!token) {
      return c.json(errorBody(API_ERROR_CODES.NOT_FOUND, 'File not found.'), 404);
    }

    // ── Rate limiting ──────────────────────────────────────────────────────
    const rawIp = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip');
    const ipHash = await hashIp(rawIp);

    if (ipHash) {
      const redis = resolvedDeps.getRedis();
      const reportRateLimitPerIp = await resolvedDeps.loadReportRateLimit();

      const globalLimit = await applyRateLimit(
        redis,
        `rl:report:${ipHash}`,
        reportRateLimitPerIp,
        REPORT_RATE_WINDOW_SECONDS,
        logger
      );

      if (globalLimit.limited) {
        logger.warn('Rate limit blocked: report (global per-IP)', {
          event: 'rate_limit.blocked',
          requestId,
          actor: 'anonymous',
          entity: { type: 'http_request', id: `POST /report/${token}` },
          outcome: 'failure',
          surface: 'report',
          origin: globalLimit.origin,
          limit: globalLimit.limit,
          count: globalLimit.count,
          resetInSeconds: globalLimit.resetInSeconds
        });
        recordBlockedMetricBestEffort(recordRateLimitBlocked(redis, 'report'), 'report', logger);
        return c.json(
          errorBody(API_ERROR_CODES.RATE_LIMITED, 'Too many reports. Please try again later.'),
          429
        );
      }

      const fileLimit = await applyRateLimit(
        redis,
        `rl:report:${token}:${ipHash}`,
        REPORT_PER_FILE_RATE_LIMIT,
        REPORT_RATE_WINDOW_SECONDS,
        logger
      );

      if (fileLimit.limited) {
        logger.warn('Rate limit blocked: report (per-file per-IP)', {
          event: 'rate_limit.blocked',
          requestId,
          actor: 'anonymous',
          entity: { type: 'http_request', id: `POST /report/${token}` },
          outcome: 'failure',
          surface: 'report_per_file',
          origin: fileLimit.origin,
          limit: fileLimit.limit,
          count: fileLimit.count,
          resetInSeconds: fileLimit.resetInSeconds
        });
        recordBlockedMetricBestEffort(
          recordRateLimitBlocked(redis, 'report_per_file'),
          'report_per_file',
          logger
        );
        return c.json(
          errorBody(
            API_ERROR_CODES.RATE_LIMITED,
            'You have already reported this file. Please try again later.'
          ),
          429
        );
      }
    }

    // ── Validate request body ─────────────────────────────────────────────
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(errorBody(API_ERROR_CODES.VALIDATION_ERROR, 'Request body must be JSON.'), 400);
    }

    const parsedBody = reportRequestSchema.safeParse(body);
    if (!parsedBody.success) {
      return c.json(errorBody(API_ERROR_CODES.VALIDATION_ERROR, 'Invalid report payload.'), 400);
    }

    const { reason, message } = parsedBody.data;
    const db = resolvedDeps.getDb();

    // ── Look up file ──────────────────────────────────────────────────────
    const file = await db.query.files.findFirst({ where: eq(files.token, token) });

    if (!file) {
      return c.json(errorBody(API_ERROR_CODES.NOT_FOUND, 'File not found.'), 404);
    }

    if (UNREPORTABLE_STATUSES.has(file.status)) {
      return c.json(errorBody(API_ERROR_CODES.NOT_FOUND, 'File not found.'), 404);
    }

    if (HIDDEN_STATUSES.has(file.status)) {
      const code =
        file.status === 'deleted' ? API_ERROR_CODES.FILE_DELETED : API_ERROR_CODES.FILE_HIDDEN;
      return c.json(errorBody(code, 'File is not available.'), 410);
    }

    // ── Persist report ────────────────────────────────────────────────────
    const now = resolvedDeps.now();
    const autoHideThreshold = await resolvedDeps.loadAutoHideThreshold();
    let reportId: string;
    let newReportCount: number;
    let autoHidden = false;

    try {
      const result = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(reports)
          .values({
            fileId: file.id,
            reason,
            message: message ?? null,
            status: 'pending',
            ipHash: ipHash ?? null,
            createdAt: now
          })
          .returning({ id: reports.id });

        if (!inserted) throw new Error('Report insert returned no row.');

        const [updated] = await tx
          .update(files)
          .set({ reportCount: sql`${files.reportCount} + 1` })
          .where(eq(files.id, file.id))
          .returning({ reportCount: files.reportCount, status: files.status });

        if (!updated) throw new Error('File report_count update returned no row.');

        const isPubliclyAccessible = updated.status === 'active' || updated.status === 'expiring';

        if (isPubliclyAccessible && updated.reportCount >= autoHideThreshold) {
          const [promoted] = await tx
            .update(files)
            .set({ status: 'hidden' })
            .where(and(eq(files.id, file.id), sql`${files.status} IN ('active', 'expiring')`))
            .returning({ id: files.id });

          if (promoted) {
            await tx.insert(fileModerationActions).values({
              fileId: file.id,
              action: 'hide',
              previousStatus: updated.status,
              nextStatus: 'hidden',
              actorGithubId: '0',
              actorGithubLogin: 'system:auto_hide',
              reason: `Auto-hidden after ${updated.reportCount} reports.`,
              createdAt: now
            });

            autoHidden = true;
          }
        }

        return { reportId: inserted.id, newReportCount: updated.reportCount };
      });

      reportId = result.reportId;
      newReportCount = result.newReportCount;
    } catch (err) {
      logger.error('Report persistence failed', {
        event: 'report.create_failed',
        requestId,
        actor: 'anonymous',
        entity: { type: 'file', id: file.id },
        outcome: 'failure',
        error: err instanceof Error ? err.message : String(err)
      });
      return c.json(errorBody(API_ERROR_CODES.INTERNAL_ERROR, 'Failed to submit report.'), 500);
    }

    logger.info('Report created', {
      event: 'report.created',
      requestId,
      actor: 'anonymous',
      entity: { type: 'report', id: reportId },
      outcome: 'success',
      fileId: file.id,
      reason,
      newReportCount
    });

    if (autoHidden) {
      logger.info('File auto-hidden', {
        event: 'file.hidden',
        requestId,
        actor: 'system',
        entity: { type: 'file', id: file.id },
        outcome: 'success',
        trigger: 'automatic',
        reportCount: newReportCount
      });
    }

    return c.json({ ok: true as const, data: { id: reportId, createdAt: now.toISOString() } }, 200);
  });

  return router;
}

export const reportRouter = createReportRouter();
