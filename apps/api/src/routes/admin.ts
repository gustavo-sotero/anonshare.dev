import type { OperationalAnomalySeverity } from '@anonshare/contracts';
import { auth as authConfig } from '@anonshare/infrastructure/config';
import { createDb } from '@anonshare/infrastructure/db';
import { adminSessions, operationalAnomalies } from '@anonshare/infrastructure/db/schema';
import { logger } from '@anonshare/infrastructure/logger';
import { desc, eq, isNull, sql } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { getCleanupQueue, getExpireQueue, getReconcileQueue } from '../queues';

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
  getAllowedGithubUserId?: () => string;
  getQueues?: () => QueueStatsReader[];
  now?: () => Date;
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
): Promise<Response | undefined> {
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
    return c.json(accessDeniedBody('session_required'), 401);
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
    return c.json({ error: 'internal_error' }, 500);
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
    return c.json(accessDeniedBody('session_required'), 401);
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
    return c.json(accessDeniedBody('session_expired'), 401);
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
    return c.json(accessDeniedBody('not_allowlisted'), 403);
  }

  return undefined;
}

async function buildQueueHealthSnapshot(
  queue: QueueStatsReader,
  nowMs: number,
  requestId: string
) {
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
    status: degraded ? ('degraded' satisfies QueueHealthStatus) : ('healthy' satisfies QueueHealthStatus),
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
    getAllowedGithubUserId: deps.getAllowedGithubUserId ?? authConfig.githubAllowedUserId,
    getQueues: deps.getQueues ?? defaultGetQueues,
    now: deps.now ?? (() => new Date())
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
    const denied = await requireAdminSession(c, resolvedDeps);
    if (denied) {
      return denied;
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
    const denied = await requireAdminSession(c, resolvedDeps);
    if (denied) {
      return denied;
    }

    try {
      const nowMs = resolvedDeps.now().getTime();
      const requestId = getRequestId(c);
      const [anomalyCounts, queueHealth] = await Promise.all([
        resolvedDeps.listOpenAnomalyCounts(),
        Promise.all(
          resolvedDeps.getQueues().map((queue) => buildQueueHealthSnapshot(queue, nowMs, requestId))
        )
      ]);

      const openAnomaliesByType = Object.fromEntries(
        anomalyCounts.map((row) => [row.type, row.count])
      );
      const openAnomaliesTotal = anomalyCounts.reduce((sum, row) => sum + row.count, 0);

      return c.json(
        {
          openAnomaliesTotal,
          openAnomaliesByType,
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

  router.get('/files', (c) => c.json({ error: 'not_implemented' }, 501));
  router.get('/reports', (c) => c.json({ error: 'not_implemented' }, 501));

  return router;
}

export const adminRouter = createAdminRouter();
