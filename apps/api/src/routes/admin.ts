import type { OperationalAnomalySeverity } from '@anonshare/contracts';
import {
  adminFileListQuerySchema,
  adminReportListQuerySchema,
  moderationActionSchema,
  resolveReportSchema
} from '@anonshare/contracts';
import { auth as authConfig } from '@anonshare/infrastructure/config';
import { createDb } from '@anonshare/infrastructure/db';
import {
  adminSessions,
  fileModerationActions,
  files,
  operationalAnomalies,
  reports
} from '@anonshare/infrastructure/db/schema';
import { logger } from '@anonshare/infrastructure/logger';
import {
  listRateLimitBlockedCountsByDay,
  RATE_LIMIT_BLOCKED_METRIC_SURFACES
} from '@anonshare/infrastructure/rate-limit';
import { getRedisClient } from '@anonshare/infrastructure/redis';
import { and, asc, count, desc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import {
  enqueueCleanupFileJob,
  getCleanupQueue,
  getExpireQueue,
  getReconcileQueue
} from '../queues';

const ADMIN_SESSION_COOKIE_NAME = 'anonshare_admin_session';
const DEFAULT_ANOMALY_LIMIT = 50;
const MAX_ANOMALY_LIMIT = 200;

type LifecycleQueueName = 'expire-file' | 'cleanup-file' | 'reconcile';

type SessionRecord = {
  id: string;
  githubId: string;
  githubLogin: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

type AnomalyRecord = {
  id: string;
  type: typeof operationalAnomalies.$inferSelect.type;
  fileId: string | null;
  details: Record<string, unknown> | null;
  detectedAt: Date;
  resolvedAt: Date | null;
  resolution: string | null;
};

type AnomalyCountRecord = {
  type: typeof operationalAnomalies.$inferSelect.type;
  count: number;
};

type ReportStatusCountRecord = {
  status: typeof reports.$inferSelect.status;
  count: number;
};

type DailyCountRecord = {
  day: string;
  count: number;
};

type QueueJobSample = {
  timestamp?: number;
  delay?: number;
};

type QueueJobHistorySample = {
  attemptsMade?: number;
  processedOn?: number;
  finishedOn?: number;
};

type QueueProcessingSummary = {
  sampledJobs: number;
  retriedJobs: number;
  retryRate: number;
  avgAttemptsMade: number;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
};

type QueueHealthStatus = 'healthy' | 'degraded';

type QueueStatsReader = {
  name: string;
  getJobCounts(): Promise<Record<string, number>>;
  getWaiting(start: number, end: number): Promise<QueueJobSample[]>;
  getDelayed(start: number, end: number): Promise<QueueJobSample[]>;
  getJobs(
    types: Array<'completed' | 'failed'>,
    start: number,
    end: number,
    asc?: boolean
  ): Promise<QueueJobHistorySample[]>;
};

const QUEUE_READ_TIMEOUT_MS = 3_000;
const ABUSE_METRICS_WINDOW_DAYS = 14;

class QueueReadTimeoutError extends Error {
  constructor(queueName: string, operation: string, timeoutMs: number) {
    super(`${queueName} ${operation} timed out after ${timeoutMs}ms`);
    this.name = 'QueueReadTimeoutError';
  }
}

export type AdminRouterDeps = {
  findSessionById?: (sessionId: string) => Promise<SessionRecord | null>;
  listAnomalies?: (limit: number) => Promise<AnomalyRecord[]>;
  listOpenAnomalyCounts?: () => Promise<AnomalyCountRecord[]>;
  listReportStatusCounts?: () => Promise<ReportStatusCountRecord[]>;
  listReportCountsByDay?: (startInclusiveUtc: Date) => Promise<DailyCountRecord[]>;
  listAutoHiddenCountsByDay?: (startInclusiveUtc: Date) => Promise<DailyCountRecord[]>;
  listResolvedReportCountsByDay?: (startInclusiveUtc: Date) => Promise<DailyCountRecord[]>;
  listDismissedReportCountsByDay?: (startInclusiveUtc: Date) => Promise<DailyCountRecord[]>;
  listRateLimitBlockedCountsByDay?: (
    startInclusiveUtc: Date,
    windowDays: number
  ) => Promise<DailyCountRecord[]>;
  getAllowedGithubUserId?: () => string;
  getQueues?: () => QueueStatsReader[];
  now?: () => Date;
  enqueueCleanupFile?: (fileId: string, objectKey: string, delayMs?: number) => Promise<void>;
  getDb?: () => ReturnType<typeof createDb>;
};

let _db: ReturnType<typeof createDb> | null = null;

function getDb() {
  if (!_db) {
    _db = createDb();
  }

  return _db;
}

function readCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName !== name || rest.length === 0) {
      continue;
    }

    const rawValue = rest.join('=');
    if (!rawValue) {
      return null;
    }

    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return null;
}

function getRequestId(c: Context): string {
  return c.req.header('x-request-id') ?? crypto.randomUUID();
}

function withTimeout<T>(
  operation: Promise<T>,
  queueName: string,
  operationName: string,
  timeoutMs: number
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new QueueReadTimeoutError(queueName, operationName, timeoutMs));
    }, timeoutMs);

    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function getSessionId(c: Context): string | null {
  return (
    c.req.header('x-admin-session-id') ??
    readCookieValue(c.req.header('cookie'), ADMIN_SESSION_COOKIE_NAME)
  );
}

function getFallbackSeverity(type: AnomalyRecord['type']): OperationalAnomalySeverity {
  switch (type) {
    case 'missing_object':
    case 'failed_cleanup':
    case 'reconciliation_scan_incomplete':
      return 'high';
    case 'orphaned_object':
    case 'stale_expiration':
    case 'lifecycle_job_overdue':
    case 'lifecycle_job_duplicate':
      return 'medium';
  }
}

function getAnomalySeverity(
  type: AnomalyRecord['type'],
  details: Record<string, unknown> | null
): OperationalAnomalySeverity {
  const severity = details?.severity;

  if (severity === 'low' || severity === 'medium' || severity === 'high') {
    return severity;
  }

  return getFallbackSeverity(type);
}

function accessDeniedBody(reason: 'session_required' | 'session_expired' | 'not_allowlisted') {
  switch (reason) {
    case 'session_required':
      return { reason, message: 'Admin session required.' };
    case 'session_expired':
      return { reason, message: 'Admin session expired.' };
    case 'not_allowlisted':
      return { reason, message: 'GitHub account is not allowlisted.' };
  }
}

function clampAnomalyLimit(rawLimit: string | undefined): number {
  const parsed = Number(rawLimit);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_ANOMALY_LIMIT;
  }

  return Math.min(parsed, MAX_ANOMALY_LIMIT);
}

function computeQueueLagMs(
  waitingJobs: QueueJobSample[],
  delayedJobs: QueueJobSample[],
  nowMs: number
): number {
  const waiting = waitingJobs.at(0);
  const delayed = delayedJobs.at(0);

  const waitingLagMs =
    typeof waiting?.timestamp === 'number' ? Math.max(0, nowMs - waiting.timestamp) : 0;
  const delayedLagMs =
    typeof delayed?.timestamp === 'number'
      ? Math.max(0, nowMs - (delayed.timestamp + (delayed.delay ?? 0)))
      : 0;

  return Math.max(waitingLagMs, delayedLagMs);
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function computeQueueProcessingSummary(jobs: QueueJobHistorySample[]): QueueProcessingSummary {
  if (jobs.length === 0) {
    return {
      sampledJobs: 0,
      retriedJobs: 0,
      retryRate: 0,
      avgAttemptsMade: 0,
      avgDurationMs: null,
      p95DurationMs: null
    };
  }

  let attemptsTotal = 0;
  let retriedJobs = 0;
  const durationsMs: number[] = [];

  for (const job of jobs) {
    const attemptsMade = Math.max(0, job.attemptsMade ?? 0);
    attemptsTotal += attemptsMade;
    if (attemptsMade > 0) {
      retriedJobs += 1;
    }

    if (typeof job.processedOn === 'number' && typeof job.finishedOn === 'number') {
      durationsMs.push(Math.max(0, job.finishedOn - job.processedOn));
    }
  }

  durationsMs.sort((left, right) => left - right);

  const avgDurationMs =
    durationsMs.length > 0
      ? Math.round(durationsMs.reduce((sum, duration) => sum + duration, 0) / durationsMs.length)
      : null;

  const p95DurationMs =
    durationsMs.length > 0
      ? (durationsMs[Math.max(0, Math.ceil(durationsMs.length * 0.95) - 1)] ?? null)
      : null;

  return {
    sampledJobs: jobs.length,
    retriedJobs,
    retryRate: roundTo(retriedJobs / jobs.length, 4),
    avgAttemptsMade: roundTo(attemptsTotal / jobs.length, 2),
    avgDurationMs,
    p95DurationMs
  };
}

function normalizeQueueName(name: string): LifecycleQueueName {
  switch (name) {
    case 'expire-file':
    case 'cleanup-file':
    case 'reconcile':
      return name;
    default:
      throw new Error(`Unsupported lifecycle queue: ${name}`);
  }
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function formatUtcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function buildDailySeries(
  rows: DailyCountRecord[],
  startInclusiveUtc: Date,
  windowDays: number
): DailyCountRecord[] {
  const byDay = new Map(rows.map((row) => [row.day, row.count]));
  const series: DailyCountRecord[] = [];

  for (let dayOffset = 0; dayOffset < windowDays; dayOffset += 1) {
    const currentDay = new Date(startInclusiveUtc);
    currentDay.setUTCDate(startInclusiveUtc.getUTCDate() + dayOffset);
    const day = formatUtcDay(currentDay);

    series.push({ day, count: byDay.get(day) ?? 0 });
  }

  return series;
}

function resolveRestoredFileStatus(params: {
  file: typeof files.$inferSelect;
  latestHiddenPreviousStatus: typeof files.$inferSelect.status | null;
  now: Date;
}): typeof files.$inferSelect.status {
  const { file, latestHiddenPreviousStatus, now } = params;

  if (file.expiresAt && file.expiresAt <= now) {
    return 'expired';
  }

  if (latestHiddenPreviousStatus === 'active' || latestHiddenPreviousStatus === 'expiring') {
    return latestHiddenPreviousStatus;
  }

  return 'active';
}

async function defaultFindSessionById(sessionId: string): Promise<SessionRecord | null> {
  const session = await getDb().query.adminSessions.findFirst({
    where: eq(adminSessions.id, sessionId)
  });

  return session ?? null;
}

async function defaultListAnomalies(limit: number): Promise<AnomalyRecord[]> {
  return getDb()
    .select({
      id: operationalAnomalies.id,
      type: operationalAnomalies.type,
      fileId: operationalAnomalies.fileId,
      details: sql<Record<string, unknown> | null>`${operationalAnomalies.details}`,
      detectedAt: operationalAnomalies.detectedAt,
      resolvedAt: operationalAnomalies.resolvedAt,
      resolution: operationalAnomalies.resolution
    })
    .from(operationalAnomalies)
    .where(isNull(operationalAnomalies.resolvedAt))
    .orderBy(desc(operationalAnomalies.detectedAt))
    .limit(limit);
}

async function defaultListOpenAnomalyCounts(): Promise<AnomalyCountRecord[]> {
  return getDb()
    .select({
      type: operationalAnomalies.type,
      count: sql<number>`count(*)::int`
    })
    .from(operationalAnomalies)
    .where(isNull(operationalAnomalies.resolvedAt))
    .groupBy(operationalAnomalies.type);
}

async function defaultListReportStatusCounts(): Promise<ReportStatusCountRecord[]> {
  return getDb()
    .select({
      status: reports.status,
      count: sql<number>`count(*)::int`
    })
    .from(reports)
    .groupBy(reports.status);
}

async function defaultListReportCountsByDay(startInclusiveUtc: Date): Promise<DailyCountRecord[]> {
  const dayBucket = sql<string>`to_char(date_trunc('day', timezone('UTC', ${reports.createdAt})), 'YYYY-MM-DD')`;

  return getDb()
    .select({
      day: dayBucket,
      count: sql<number>`count(*)::int`
    })
    .from(reports)
    .where(gte(reports.createdAt, startInclusiveUtc))
    .groupBy(dayBucket)
    .orderBy(asc(dayBucket));
}

async function defaultListAutoHiddenCountsByDay(
  startInclusiveUtc: Date
): Promise<DailyCountRecord[]> {
  const dayBucket = sql<string>`to_char(date_trunc('day', timezone('UTC', ${fileModerationActions.createdAt})), 'YYYY-MM-DD')`;

  return getDb()
    .select({
      day: dayBucket,
      count: sql<number>`count(*)::int`
    })
    .from(fileModerationActions)
    .where(
      and(
        eq(fileModerationActions.action, 'hide'),
        eq(fileModerationActions.actorGithubLogin, 'system:auto_hide'),
        gte(fileModerationActions.createdAt, startInclusiveUtc)
      )
    )
    .groupBy(dayBucket)
    .orderBy(asc(dayBucket));
}

async function defaultListResolvedReportCountsByDay(
  startInclusiveUtc: Date
): Promise<DailyCountRecord[]> {
  const dayBucket = sql<string>`to_char(date_trunc('day', timezone('UTC', ${reports.resolvedAt})), 'YYYY-MM-DD')`;

  return getDb()
    .select({
      day: dayBucket,
      count: sql<number>`count(*)::int`
    })
    .from(reports)
    .where(
      and(
        eq(reports.status, 'resolved'),
        isNotNull(reports.resolvedAt),
        gte(reports.resolvedAt, startInclusiveUtc)
      )
    )
    .groupBy(dayBucket)
    .orderBy(asc(dayBucket));
}

async function defaultListDismissedReportCountsByDay(
  startInclusiveUtc: Date
): Promise<DailyCountRecord[]> {
  const dayBucket = sql<string>`to_char(date_trunc('day', timezone('UTC', ${reports.resolvedAt})), 'YYYY-MM-DD')`;

  return getDb()
    .select({
      day: dayBucket,
      count: sql<number>`count(*)::int`
    })
    .from(reports)
    .where(
      and(
        eq(reports.status, 'dismissed'),
        isNotNull(reports.resolvedAt),
        gte(reports.resolvedAt, startInclusiveUtc)
      )
    )
    .groupBy(dayBucket)
    .orderBy(asc(dayBucket));
}

async function defaultListRateLimitBlockedCountsByDay(
  startInclusiveUtc: Date,
  windowDays: number
): Promise<DailyCountRecord[]> {
  return listRateLimitBlockedCountsByDay(
    getRedisClient(),
    RATE_LIMIT_BLOCKED_METRIC_SURFACES,
    startInclusiveUtc,
    windowDays
  );
}

function defaultGetQueues(): QueueStatsReader[] {
  return [getExpireQueue(), getCleanupQueue(), getReconcileQueue()];
}

async function readQueueMetric<T>(params: {
  queue: QueueStatsReader;
  requestId: string;
  operation: 'getJobCounts' | 'getWaiting' | 'getDelayed' | 'getJobs';
  read: () => Promise<T>;
  fallback: T;
}): Promise<{ value: T; degraded: boolean; error: string | null }> {
  try {
    const value = await withTimeout(
      params.read(),
      params.queue.name,
      params.operation,
      QUEUE_READ_TIMEOUT_MS
    );

    return { value, degraded: false, error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);

    logger.warn('Admin queue health read degraded', {
      event: 'admin_queue_health_degraded',
      requestId: params.requestId,
      actor: 'admin',
      entity: { type: 'queue', id: params.queue.name },
      outcome: 'failure',
      operation: params.operation,
      reason: err instanceof QueueReadTimeoutError ? 'timeout' : 'queue_read_failed',
      error
    });

    return {
      value: params.fallback,
      degraded: true,
      error
    };
  }
}

async function requireAdminSession(
  c: Context,
  deps: Required<AdminRouterDeps>
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

async function buildQueueHealthSnapshot(queue: QueueStatsReader, nowMs: number, requestId: string) {
  const [countsResult, waitingResult, delayedResult, jobsResult] = await Promise.all([
    readQueueMetric({
      queue,
      requestId,
      operation: 'getJobCounts',
      read: () => queue.getJobCounts(),
      fallback: {}
    }),
    readQueueMetric({
      queue,
      requestId,
      operation: 'getWaiting',
      read: () => queue.getWaiting(0, 0),
      fallback: []
    }),
    readQueueMetric({
      queue,
      requestId,
      operation: 'getDelayed',
      read: () => queue.getDelayed(0, 0),
      fallback: []
    }),
    readQueueMetric({
      queue,
      requestId,
      operation: 'getJobs',
      read: () => queue.getJobs(['completed', 'failed'], 0, 49),
      fallback: []
    })
  ]);

  const counts = countsResult.value;
  const waitingJobs = waitingResult.value;
  const delayedJobs = delayedResult.value;
  const recentJobs = jobsResult.value;
  const degraded =
    countsResult.degraded ||
    waitingResult.degraded ||
    delayedResult.degraded ||
    jobsResult.degraded;
  const lastError =
    countsResult.error ?? waitingResult.error ?? delayedResult.error ?? jobsResult.error ?? null;

  return {
    queue: normalizeQueueName(queue.name),
    status: degraded
      ? ('degraded' satisfies QueueHealthStatus)
      : ('healthy' satisfies QueueHealthStatus),
    lastError,
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    failed: counts.failed ?? 0,
    completed: counts.completed ?? 0,
    lagMs: computeQueueLagMs(waitingJobs, delayedJobs, nowMs),
    processing: computeQueueProcessingSummary(recentJobs)
  };
}

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
    getAllowedGithubUserId: deps.getAllowedGithubUserId ?? authConfig.githubAllowedUserId,
    getQueues: deps.getQueues ?? defaultGetQueues,
    now: deps.now ?? (() => new Date()),
    enqueueCleanupFile: deps.enqueueCleanupFile ?? enqueueCleanupFileJob,
    getDb: deps.getDb ?? getDb
  };

  const router = new Hono();

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

  router.get('/anomalies', async (c) => {
    const auth = await requireAdminSession(c, resolvedDeps);
    if (!auth.ok) {
      return auth.response;
    }

    try {
      const anomalies = await resolvedDeps.listAnomalies(clampAnomalyLimit(c.req.query('limit')));

      return c.json(
        {
          anomalies: anomalies.map((anomaly) => ({
            id: anomaly.id,
            type: anomaly.type,
            severity: getAnomalySeverity(anomaly.type, anomaly.details),
            fileId: anomaly.fileId,
            details: anomaly.details,
            detectedAt: anomaly.detectedAt.toISOString(),
            resolvedAt: anomaly.resolvedAt?.toISOString() ?? null,
            resolution: anomaly.resolution
          }))
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
      page: c.req.query('page'),
      pageSize: c.req.query('pageSize')
    });

    if (!queryParsed.success) {
      return c.json(
        { ok: false, error: { code: 'validation_error', message: 'Invalid query parameters.' } },
        400
      );
    }

    const { status, page, pageSize } = queryParsed.data;
    const offset = (page - 1) * pageSize;

    try {
      const db = resolvedDeps.getDb();
      const where = status ? eq(files.status, status) : undefined;

      const [rows, [totalRow]] = await Promise.all([
        db
          .select()
          .from(files)
          .where(where)
          .orderBy(desc(files.uploadedAt))
          .limit(pageSize)
          .offset(offset),
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

      const [fileReports, moderationHistory] = await Promise.all([
        db
          .select()
          .from(reports)
          .where(eq(reports.fileId, fileId))
          .orderBy(desc(reports.createdAt)),
        db
          .select()
          .from(fileModerationActions)
          .where(eq(fileModerationActions.fileId, fileId))
          .orderBy(desc(fileModerationActions.createdAt))
      ]);

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
            reports: fileReports.map((r) => ({
              id: r.id,
              fileId: r.fileId,
              reason: r.reason,
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

      // Determine the valid target status for each action.
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
              ? 'file.restored'
              : 'file.deleted',
        requestId,
        actor: 'admin',
        entity: { type: 'file', id: fileId },
        outcome: 'success',
        action,
        previousStatus,
        nextStatus,
        restoredFrom: latestHiddenPreviousStatus
      });

      // If deleting or restoring into an already-expired lifecycle state,
      // ensure the storage cleanup path is active.
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
      page: c.req.query('page'),
      pageSize: c.req.query('pageSize')
    });

    if (!queryParsed.success) {
      return c.json(
        { ok: false, error: { code: 'validation_error', message: 'Invalid query parameters.' } },
        400
      );
    }

    const { status, fileId, page, pageSize } = queryParsed.data;
    const offset = (page - 1) * pageSize;

    try {
      const db = resolvedDeps.getDb();

      const conditions = [
        status ? eq(reports.status, status) : null,
        fileId ? eq(reports.fileId, fileId) : null
      ].filter(Boolean);

      const where =
        conditions.length > 0
          ? and(...(conditions as [ReturnType<typeof eq>, ...ReturnType<typeof eq>[]]))
          : undefined;

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
        event: action === 'resolved' ? 'report.resolved' : 'report.dismissed',
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

  return router;
}

export const adminRouter = createAdminRouter();
