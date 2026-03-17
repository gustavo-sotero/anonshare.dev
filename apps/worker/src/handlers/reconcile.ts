import {
  type CleanupFileJobPayload,
  type ExpireFileJobPayload,
  LIFECYCLE_JOB_RETENTION,
  ONE_TIME_DOWNLOAD_CLEANUP_DELAY_MS,
  type ReconcileJobPayload
} from '@anonshare/contracts';
import type { OperationalAnomalySeverity } from '@anonshare/domain';
import type { createDb } from '@anonshare/infrastructure/db';
import { files, operationalAnomalies, systemSettings } from '@anonshare/infrastructure/db/schema';
import { logger } from '@anonshare/infrastructure/logger';
import type { storageAdapter } from '@anonshare/infrastructure/storage';
import type { Job, Queue } from 'bullmq';
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, type SQL, sql } from 'drizzle-orm';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Only treat a pending_upload as "stuck" once it is older than this threshold.
 * This gives normal uploads enough time to complete under slow connections.
 */
const PENDING_UPLOAD_STALE_THRESHOLD_MS = 10 * 60 * 1_000; // 10 minutes

/**
 * Only record a stale_expiration anomaly when the file is significantly overdue.
 * Files caught in the same reconcile window (e.g., first run after a restart)
 * do not generate noise anomalies.
 */
const STALE_EXPIRATION_ANOMALY_THRESHOLD_MS = 2 * 60 * 60 * 1_000; // 2 hours

/**
 * Max number of stale expirations fixed per reconcile run.
 */
const STALE_EXPIRATION_BATCH_SIZE = 200;

/**
 * Max number of active/expiring files checked for missing storage objects per
 * reconcile run. We scan the oldest first; subsequent runs advance the window.
 */
const MISSING_OBJECT_BATCH_SIZE = 50;

/**
 * Max number of stuck pending_upload records resolved per reconcile run.
 */
const STUCK_PENDING_BATCH_SIZE = 100;

/**
 * Max number of future expirations checked for missing delayed jobs per run.
 */
const FUTURE_EXPIRATION_BATCH_SIZE = 100;

/**
 * Max number of terminal records checked for missing cleanup jobs per run.
 */
const TERMINAL_CLEANUP_BATCH_SIZE = 100;

/**
 * Max number of storage objects scanned for orphan detection per run.
 */
const ORPHANED_OBJECT_BATCH_SIZE = 100;

/**
 * Consider pending lifecycle jobs as abnormally delayed once their scheduled
 * execution time is older than this threshold.
 */
const LIFECYCLE_JOB_OVERDUE_THRESHOLD_MS = 10 * 60 * 1_000; // 10 minutes
const LIFECYCLE_DUPLICATE_SCAN_LIMIT = 200;
const LIFECYCLE_QUEUE_READ_TIMEOUT_MS = 3_000;

const STORAGE_OBJECT_PREFIX = 'objects/';
const FUTURE_EXPIRATION_CURSOR_SETTING_KEY = 'reconcile_future_expire_cursor';
const MISSING_OBJECT_CURSOR_SETTING_KEY = 'reconcile_missing_object_cursor';
const TERMINAL_CLEANUP_CURSOR_SETTING_KEY = 'reconcile_terminal_cleanup_cursor';
const ORPHAN_SCAN_CURSOR_SETTING_KEY = 'reconcile_orphan_scan_cursor';

class QueueReadTimeoutError extends Error {
  constructor(queueName: string, operation: string, timeoutMs: number) {
    super(`${queueName} ${operation} timed out after ${timeoutMs}ms`);
    this.name = 'QueueReadTimeoutError';
  }
}

// ─── Dep types ────────────────────────────────────────────────────────────────

export type ReconcileHandlerDeps = {
  db: ReturnType<typeof createDb>;
  storage: Pick<typeof storageAdapter, 'exists' | 'list'>;
  cleanupQueue: Queue<CleanupFileJobPayload>;
  expireQueue: Queue<ExpireFileJobPayload>;
  getFutureExpirationCursor?: () => Promise<string | undefined>;
  setFutureExpirationCursor?: (cursor: string | null) => Promise<void>;
  getMissingObjectCursor?: () => Promise<string | undefined>;
  setMissingObjectCursor?: (cursor: string | null) => Promise<void>;
  getTerminalCleanupCursor?: () => Promise<string | undefined>;
  setTerminalCleanupCursor?: (cursor: string | null) => Promise<void>;
  getOrphanScanCursor?: () => Promise<string | undefined>;
  setOrphanScanCursor?: (cursor: string | null) => Promise<void>;
};

type ReconcileStorageFailurePhase =
  | 'stuck_pending'
  | 'missing_object'
  | 'terminal_cleanup'
  | 'orphaned_object_scan';

type LifecycleRepairQueue = 'expire-file' | 'cleanup-file';

type QueueLookupResult<T> = { ok: true; value: T } | { ok: false; anomalyRecorded: boolean };

type FileSweepCursorName = 'future_expiration' | 'missing_object' | 'terminal_cleanup';

type FileSweepCursor = {
  timestamp: Date;
  id: string;
};

const PENDING_QUEUE_JOB_STATES = new Set([
  'waiting',
  'active',
  'delayed',
  'prioritized',
  'waiting-children'
]);

function getAnomalySeverity(
  type:
    | 'stale_expiration'
    | 'missing_object'
    | 'orphaned_object'
    | 'failed_cleanup'
    | 'lifecycle_job_overdue'
    | 'lifecycle_job_duplicate'
    | 'reconciliation_scan_incomplete'
): OperationalAnomalySeverity {
  switch (type) {
    case 'stale_expiration':
    case 'lifecycle_job_overdue':
    case 'lifecycle_job_duplicate':
      return 'medium';
    case 'orphaned_object':
      return 'medium';
    case 'missing_object':
    case 'failed_cleanup':
    case 'reconciliation_scan_incomplete':
      return 'high';
  }
}

function withSeverity(
  details: Record<string, unknown>,
  severity: OperationalAnomalySeverity
): Record<string, unknown> {
  return { ...details, severity };
}

async function logStorageCheckFailure(params: {
  db: ReturnType<typeof createDb>;
  phase: ReconcileStorageFailurePhase;
  entity: { type: string; id: string };
  operation: 'exists' | 'list';
  err: unknown;
  objectKey?: string;
}): Promise<boolean> {
  logger.warn('Reconcile: storage check failed; leaving item for next run', {
    event: 'reconciliation.anomaly_detected',
    actor: 'worker',
    entity: params.entity,
    outcome: 'failure',
    anomalyType: 'storage_check_failed',
    phase: params.phase,
    operation: params.operation,
    ...(params.objectKey ? { objectKey: params.objectKey } : {}),
    reason: 'retry_next_run',
    error: params.err instanceof Error ? params.err.message : String(params.err)
  });

  const fileId = params.entity.type === 'file' ? params.entity.id : null;

  return recordScopedAnomalyIfAbsent(
    params.db,
    'reconciliation_scan_incomplete',
    fileId,
    {
      queue: 'reconcile',
      phase: params.phase,
      operation: params.operation,
      ...(params.objectKey ? { objectKey: params.objectKey } : {}),
      reason: 'retry_next_run'
    },
    getAnomalySeverity('reconciliation_scan_incomplete'),
    `reconcile:storage_check_failed:${params.phase}:${params.entity.id}:${params.operation}:${params.objectKey ?? 'none'}`
  );
}

function isPendingQueueJobState(state: string): boolean {
  return PENDING_QUEUE_JOB_STATES.has(state);
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

async function recordQueueReadFailure(params: {
  db: ReturnType<typeof createDb>;
  queueName: LifecycleRepairQueue | 'reconcile';
  fileId: string | null;
  operation: 'getJob' | 'getJobs';
  jobId?: string;
  err: unknown;
}): Promise<boolean> {
  logger.warn('Reconcile: failed to inspect lifecycle queue state', {
    event: 'reconciliation.anomaly_detected',
    actor: 'worker',
    entity: params.fileId
      ? { type: 'file', id: params.fileId }
      : { type: 'queue', id: params.queueName },
    outcome: 'failure',
    anomalyType: 'lifecycle_queue_read_failed',
    queue: params.queueName,
    operation: params.operation,
    ...(params.jobId ? { jobId: params.jobId } : {}),
    reason: params.err instanceof QueueReadTimeoutError ? 'timeout' : 'queue_read_failed',
    error: params.err instanceof Error ? params.err.message : String(params.err)
  });

  return recordScopedAnomalyIfAbsent(
    params.db,
    'reconciliation_scan_incomplete',
    params.fileId,
    {
      queue: params.queueName,
      operation: params.operation,
      ...(params.jobId ? { jobId: params.jobId } : {}),
      reason: params.err instanceof QueueReadTimeoutError ? 'timeout' : 'queue_read_failed'
    },
    getAnomalySeverity('reconciliation_scan_incomplete'),
    `${params.queueName}:${params.fileId ?? 'queue'}:${params.operation}:${params.jobId ?? 'all'}`
  );
}

async function getLifecycleJobSafely(params: {
  db: ReturnType<typeof createDb>;
  queue: Queue<ExpireFileJobPayload> | Queue<CleanupFileJobPayload>;
  queueName: LifecycleRepairQueue;
  fileId: string;
  jobId: string;
}): Promise<QueueLookupResult<Awaited<ReturnType<Queue['getJob']>>>> {
  try {
    const job = await withTimeout(
      params.queue.getJob(params.jobId),
      params.queueName,
      'getJob',
      LIFECYCLE_QUEUE_READ_TIMEOUT_MS
    );

    return { ok: true, value: job };
  } catch (err) {
    const anomalyRecorded = await recordQueueReadFailure({
      db: params.db,
      queueName: params.queueName,
      fileId: params.fileId,
      operation: 'getJob',
      jobId: params.jobId,
      err
    });

    return { ok: false, anomalyRecorded };
  }
}

function withOptionalCursorCondition(
  baseCondition: SQL<unknown>,
  cursorCondition: SQL<unknown> | undefined
): SQL<unknown> {
  if (!cursorCondition) {
    return baseCondition;
  }

  return and(baseCondition, cursorCondition) ?? baseCondition;
}

function buildFileSweepCursorCondition(
  column: typeof files.uploadedAt | typeof files.expiresAt,
  cursor: FileSweepCursor | undefined
): SQL<unknown> | undefined {
  if (!cursor) {
    return undefined;
  }

  return sql`(${column}, ${files.id}) > (${cursor.timestamp.toISOString()}, ${cursor.id})`;
}

function parseFileSweepCursor(rawCursor: string | undefined): FileSweepCursor | undefined {
  if (!rawCursor) {
    return undefined;
  }

  const separatorIndex = rawCursor.lastIndexOf('|');
  if (separatorIndex <= 0 || separatorIndex === rawCursor.length - 1) {
    return undefined;
  }

  const timestamp = new Date(rawCursor.slice(0, separatorIndex));
  if (Number.isNaN(timestamp.getTime())) {
    return undefined;
  }

  return {
    timestamp,
    id: rawCursor.slice(separatorIndex + 1)
  };
}

function serializeFileSweepCursor(cursor: FileSweepCursor | null): string | null {
  if (!cursor) {
    return null;
  }

  return `${cursor.timestamp.toISOString()}|${cursor.id}`;
}

function getNextFileSweepCursor(
  rows: Array<{ id: string; cursorTimestamp: Date | null }>,
  batchSize: number
): FileSweepCursor | null {
  if (rows.length === 0 || rows.length < batchSize) {
    return null;
  }

  const lastRow = rows.at(-1);
  if (!lastRow?.cursorTimestamp) {
    return null;
  }

  return {
    timestamp: lastRow.cursorTimestamp,
    id: lastRow.id
  };
}

async function readPersistedFileSweepCursor(params: {
  db: ReturnType<typeof createDb>;
  settingKey: string;
}): Promise<FileSweepCursor | undefined> {
  const setting = await params.db.query.systemSettings.findFirst({
    where: eq(systemSettings.key, params.settingKey)
  });

  const rawCursor = setting?.value.trim();
  if (!rawCursor) {
    return undefined;
  }

  return parseFileSweepCursor(rawCursor);
}

async function writePersistedFileSweepCursor(params: {
  db: ReturnType<typeof createDb>;
  settingKey: string;
  cursor: FileSweepCursor | null;
}): Promise<void> {
  const serializedCursor = serializeFileSweepCursor(params.cursor) ?? '';

  await params.db
    .insert(systemSettings)
    .values({
      key: params.settingKey,
      value: serializedCursor
    })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: {
        value: serializedCursor,
        updatedAt: sql`now()`
      }
    });
}

async function recordLifecycleSweepCursorIssue(params: {
  db: ReturnType<typeof createDb>;
  cursorName: FileSweepCursorName;
  reason: 'cursor_invalid' | 'cursor_read_failed' | 'cursor_write_failed';
  rawCursor?: string;
  error?: unknown;
}): Promise<boolean> {
  return recordScopedAnomalyIfAbsent(
    params.db,
    'reconciliation_scan_incomplete',
    null,
    {
      queue: 'reconcile',
      cursor: params.cursorName,
      reason: params.reason,
      ...(params.rawCursor ? { rawCursor: params.rawCursor } : {})
    },
    getAnomalySeverity('reconciliation_scan_incomplete'),
    `reconcile:${params.cursorName}:${params.reason}`
  );
}

async function loadFileSweepCursorSafely(params: {
  db: ReturnType<typeof createDb>;
  cursorName: FileSweepCursorName;
  getCursor: () => Promise<string | undefined>;
  setCursor: (cursor: string | null) => Promise<void>;
}): Promise<{ cursor: FileSweepCursor | undefined; anomaliesRecorded: number }> {
  let rawCursor: string | undefined;

  try {
    rawCursor = await params.getCursor();
  } catch (err) {
    logger.warn('Reconcile: failed to load lifecycle sweep cursor; starting from batch head', {
      event: 'reconciliation.anomaly_detected',
      actor: 'worker',
      entity: { type: 'queue', id: 'reconcile' },
      outcome: 'failure',
      anomalyType: 'lifecycle_scan_cursor_failed',
      cursor: params.cursorName,
      reason: 'cursor_read_failed',
      error: err instanceof Error ? err.message : String(err)
    });

    return {
      cursor: undefined,
      anomaliesRecorded: (await recordLifecycleSweepCursorIssue({
        db: params.db,
        cursorName: params.cursorName,
        reason: 'cursor_read_failed',
        error: err
      }))
        ? 1
        : 0
    };
  }

  if (!rawCursor) {
    return { cursor: undefined, anomaliesRecorded: 0 };
  }

  const parsedCursor = parseFileSweepCursor(rawCursor);
  if (parsedCursor) {
    return { cursor: parsedCursor, anomaliesRecorded: 0 };
  }

  logger.warn('Reconcile: invalid lifecycle sweep cursor; starting from batch head', {
    event: 'reconciliation.anomaly_detected',
    actor: 'worker',
    entity: { type: 'queue', id: 'reconcile' },
    outcome: 'failure',
    anomalyType: 'lifecycle_scan_cursor_invalid',
    cursor: params.cursorName,
    reason: 'cursor_invalid',
    rawCursor
  });

  let anomaliesRecorded = (await recordLifecycleSweepCursorIssue({
    db: params.db,
    cursorName: params.cursorName,
    reason: 'cursor_invalid',
    rawCursor
  }))
    ? 1
    : 0;

  try {
    await params.setCursor(null);
  } catch (err) {
    logger.warn('Reconcile: failed to clear invalid lifecycle sweep cursor', {
      event: 'reconciliation.anomaly_detected',
      actor: 'worker',
      entity: { type: 'queue', id: 'reconcile' },
      outcome: 'failure',
      anomalyType: 'lifecycle_scan_cursor_failed',
      cursor: params.cursorName,
      reason: 'cursor_write_failed',
      error: err instanceof Error ? err.message : String(err)
    });

    if (
      await recordLifecycleSweepCursorIssue({
        db: params.db,
        cursorName: params.cursorName,
        reason: 'cursor_write_failed',
        error: err
      })
    ) {
      anomaliesRecorded += 1;
    }
  }

  return { cursor: undefined, anomaliesRecorded };
}

async function persistFileSweepCursorSafely(params: {
  db: ReturnType<typeof createDb>;
  cursorName: FileSweepCursorName;
  setCursor: (cursor: string | null) => Promise<void>;
  cursor: FileSweepCursor | null;
}): Promise<number> {
  try {
    await params.setCursor(serializeFileSweepCursor(params.cursor));
    return 0;
  } catch (err) {
    logger.warn('Reconcile: failed to persist lifecycle sweep cursor', {
      event: 'reconciliation.anomaly_detected',
      actor: 'worker',
      entity: { type: 'queue', id: 'reconcile' },
      outcome: 'failure',
      anomalyType: 'lifecycle_scan_cursor_failed',
      cursor: params.cursorName,
      reason: 'cursor_write_failed',
      error: err instanceof Error ? err.message : String(err)
    });

    return (await recordLifecycleSweepCursorIssue({
      db: params.db,
      cursorName: params.cursorName,
      reason: 'cursor_write_failed',
      error: err
    }))
      ? 1
      : 0;
  }
}

async function loadOrphanScanCursor(db: ReturnType<typeof createDb>): Promise<string | undefined> {
  try {
    const setting = await db.query.systemSettings.findFirst({
      where: eq(systemSettings.key, ORPHAN_SCAN_CURSOR_SETTING_KEY)
    });

    const rawCursor = setting?.value.trim();
    return rawCursor ? rawCursor : undefined;
  } catch (err) {
    logger.warn('Reconcile: failed to load orphan scan cursor; starting from bucket head', {
      event: 'reconciliation.anomaly_detected',
      actor: 'worker',
      entity: { type: 'queue', id: 'reconcile' },
      outcome: 'failure',
      anomalyType: 'orphaned_object_scan_cursor_failed',
      reason: 'cursor_read_failed',
      error: err instanceof Error ? err.message : String(err)
    });

    await recordScopedAnomalyIfAbsent(
      db,
      'reconciliation_scan_incomplete',
      null,
      {
        queue: 'reconcile',
        reason: 'cursor_read_failed'
      },
      getAnomalySeverity('reconciliation_scan_incomplete'),
      'reconcile:cursor_read_failed'
    );

    return undefined;
  }
}

async function persistOrphanScanCursor(
  db: ReturnType<typeof createDb>,
  cursor: string | null
): Promise<void> {
  try {
    await db
      .insert(systemSettings)
      .values({
        key: ORPHAN_SCAN_CURSOR_SETTING_KEY,
        value: cursor ?? ''
      })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: cursor ?? '', updatedAt: sql`now()` }
      });
  } catch (err) {
    logger.warn('Reconcile: failed to persist orphan scan cursor', {
      event: 'reconciliation.anomaly_detected',
      actor: 'worker',
      entity: { type: 'queue', id: 'reconcile' },
      outcome: 'failure',
      anomalyType: 'orphaned_object_scan_cursor_failed',
      reason: 'cursor_write_failed',
      cursor,
      error: err instanceof Error ? err.message : String(err)
    });

    await recordScopedAnomalyIfAbsent(
      db,
      'reconciliation_scan_incomplete',
      null,
      {
        queue: 'reconcile',
        reason: 'cursor_write_failed'
      },
      getAnomalySeverity('reconciliation_scan_incomplete'),
      'reconcile:cursor_write_failed'
    );
  }
}

function resolveOlderThan(rawOlderThan: string | undefined): Date {
  if (!rawOlderThan) {
    return new Date();
  }

  const parsed = new Date(rawOlderThan);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  logger.warn('Reconcile: invalid olderThan payload, defaulting to now', {
    event: 'reconciliation.anomaly_detected',
    actor: 'worker',
    entity: { type: 'queue', id: 'reconcile' },
    outcome: 'failure',
    anomalyType: 'invalid_reconcile_payload',
    reason: 'invalid_older_than',
    olderThan: rawOlderThan
  });

  return new Date();
}

function getLifecycleJobOverdueMs(
  existingJob: Awaited<ReturnType<Queue['getJob']>>
): number | null {
  if (!existingJob) {
    return null;
  }

  const timestamp = typeof existingJob.timestamp === 'number' ? existingJob.timestamp : Number.NaN;
  const delay = typeof existingJob.delay === 'number' ? existingJob.delay : 0;

  if (Number.isNaN(timestamp)) {
    return null;
  }

  const scheduledAt = timestamp + Math.max(0, delay);
  return Date.now() - scheduledAt;
}

function toJobId(rawJobId: unknown): string {
  if (typeof rawJobId === 'string' || typeof rawJobId === 'number') {
    return String(rawJobId);
  }

  return 'unknown';
}

function shouldDelayConsumedCleanup(file: { status: string; consumedAt?: Date | null }): boolean {
  if (file.status !== 'consumed' || !file.consumedAt) {
    return false;
  }

  return Date.now() - file.consumedAt.getTime() < ONE_TIME_DOWNLOAD_CLEANUP_DELAY_MS;
}

function getDuplicateFileJobs(
  jobs: Array<{
    id: unknown;
    data: { fileId?: string };
  }>
): Array<{ fileId: string; jobIds: string[] }> {
  const jobsByFileId = new Map<string, string[]>();

  for (const job of jobs) {
    const fileId = job.data.fileId;

    if (typeof fileId !== 'string' || fileId.length === 0) {
      continue;
    }

    const existingJobIds = jobsByFileId.get(fileId);
    if (existingJobIds) {
      existingJobIds.push(toJobId(job.id));
      continue;
    }

    jobsByFileId.set(fileId, [toJobId(job.id)]);
  }

  return Array.from(jobsByFileId.entries())
    .filter(([, jobIds]) => jobIds.length > 1)
    .map(([fileId, jobIds]) => ({ fileId, jobIds }));
}

async function shouldSkipRepairEnqueue(params: {
  db: ReturnType<typeof createDb>;
  existingJob: Awaited<ReturnType<Queue['getJob']>>;
  queueName: LifecycleRepairQueue;
  fileId: string;
}): Promise<boolean> {
  if (!params.existingJob) {
    return false;
  }

  let state: string;
  try {
    state = await params.existingJob.getState();
  } catch (err) {
    logger.warn('Reconcile: unable to inspect existing lifecycle job state', {
      event: 'reconciliation.anomaly_detected',
      actor: 'worker',
      entity: { type: 'file', id: params.fileId },
      outcome: 'failure',
      anomalyType: 'lifecycle_job_state_unreadable',
      queue: params.queueName,
      reason: 'state_lookup_failed',
      error: err instanceof Error ? err.message : String(err)
    });

    await recordScopedAnomalyIfAbsent(
      params.db,
      'reconciliation_scan_incomplete',
      params.fileId,
      {
        queue: params.queueName,
        reason: 'state_lookup_failed'
      },
      getAnomalySeverity('reconciliation_scan_incomplete'),
      `${params.queueName}:${params.fileId}:state_lookup_failed`
    );

    return true;
  }

  if (isPendingQueueJobState(state)) {
    const overdueMs = getLifecycleJobOverdueMs(params.existingJob);

    if (typeof overdueMs === 'number' && overdueMs > LIFECYCLE_JOB_OVERDUE_THRESHOLD_MS) {
      logger.warn('Reconcile: existing lifecycle job is pending but overdue', {
        event: 'reconciliation.anomaly_detected',
        actor: 'worker',
        entity: { type: 'file', id: params.fileId },
        outcome: 'failure',
        anomalyType: 'lifecycle_job_overdue',
        queue: params.queueName,
        state,
        jobId: params.existingJob.id ?? null,
        overdueMs,
        reason: 'pending_job_overdue'
      });

      await recordScopedAnomalyIfAbsent(
        params.db,
        'lifecycle_job_overdue',
        params.fileId,
        {
          queue: params.queueName,
          state,
          jobId: params.existingJob.id ?? null,
          overdueMs,
          reason: 'pending_job_overdue'
        },
        getAnomalySeverity('lifecycle_job_overdue'),
        `${params.queueName}:${params.fileId}:pending_job_overdue`
      );
    }

    return true;
  }

  if (state !== 'completed' && state !== 'failed') {
    logger.warn('Reconcile: existing lifecycle job in unsupported state, skipping repair enqueue', {
      event: 'reconciliation.anomaly_detected',
      actor: 'worker',
      entity: { type: 'file', id: params.fileId },
      outcome: 'failure',
      anomalyType: 'lifecycle_job_state_unsupported',
      queue: params.queueName,
      state,
      reason: 'unsupported_state'
    });

    await recordScopedAnomalyIfAbsent(
      params.db,
      'reconciliation_scan_incomplete',
      params.fileId,
      {
        queue: params.queueName,
        state,
        reason: 'unsupported_state'
      },
      getAnomalySeverity('reconciliation_scan_incomplete'),
      `${params.queueName}:${params.fileId}:unsupported_state`
    );

    return true;
  }

  try {
    await params.existingJob.remove();
  } catch (err) {
    logger.warn('Reconcile: failed to remove stale terminal lifecycle job before repair enqueue', {
      event: 'reconciliation.anomaly_detected',
      actor: 'worker',
      entity: { type: 'file', id: params.fileId },
      outcome: 'failure',
      anomalyType: 'lifecycle_job_remove_failed',
      queue: params.queueName,
      state,
      reason: 'remove_failed',
      error: err instanceof Error ? err.message : String(err)
    });

    await recordScopedAnomalyIfAbsent(
      params.db,
      'reconciliation_scan_incomplete',
      params.fileId,
      {
        queue: params.queueName,
        state,
        reason: 'remove_failed'
      },
      getAnomalySeverity('reconciliation_scan_incomplete'),
      `${params.queueName}:${params.fileId}:remove_failed`
    );

    return true;
  }

  logger.info('Reconcile: removed stale terminal lifecycle job before repair enqueue', {
    event: 'reconciliation.anomaly_detected',
    actor: 'worker',
    entity: { type: 'file', id: params.fileId },
    outcome: 'success',
    anomalyType: 'lifecycle_job_repair',
    queue: params.queueName,
    state,
    resolution: 'removed_terminal_job'
  });

  return false;
}

// ─── Handler factory ──────────────────────────────────────────────────────────

/**
 * Factory that produces a BullMQ processor function for reconcile jobs.
 *
 * The reconciler is the second layer of lifecycle correctness on top of
 * individual delayed jobs. It detects and corrects divergences between the
 * database, the job queue, and object storage.
 *
 * Seven passes per run:
 * A. Fix stale expirations (active files past their expires_at).
 * B. Repair missing future expire jobs.
 * C. Handle stuck pending_upload records (promote or remove).
 * D. Detect active files whose storage object is missing (mark as missing).
 * E. Repair missing cleanup jobs for terminal file states.
 * F. Detect orphaned storage objects without metadata.
 * G. Detect duplicate pending lifecycle jobs.
 */
export function makeHandleReconcile(deps: ReconcileHandlerDeps) {
  return async function handleReconcile(job: Job<ReconcileJobPayload>): Promise<void> {
    const startedAtMs = Date.now();
    const olderThan = resolveOlderThan(job.data.olderThan);
    const { db, storage, cleanupQueue, expireQueue } = deps;
    const getFutureExpirationCursor =
      deps.getFutureExpirationCursor ??
      (() =>
        readPersistedFileSweepCursor({
          db,
          settingKey: FUTURE_EXPIRATION_CURSOR_SETTING_KEY
        }).then((cursor) => serializeFileSweepCursor(cursor ?? null) ?? undefined));
    const setFutureExpirationCursor =
      deps.setFutureExpirationCursor ??
      ((cursor: string | null) =>
        writePersistedFileSweepCursor({
          db,
          settingKey: FUTURE_EXPIRATION_CURSOR_SETTING_KEY,
          cursor: parseFileSweepCursor(cursor ?? undefined) ?? null
        }));
    const getMissingObjectCursor =
      deps.getMissingObjectCursor ??
      (() =>
        readPersistedFileSweepCursor({
          db,
          settingKey: MISSING_OBJECT_CURSOR_SETTING_KEY
        }).then((cursor) => serializeFileSweepCursor(cursor ?? null) ?? undefined));
    const setMissingObjectCursor =
      deps.setMissingObjectCursor ??
      ((cursor: string | null) =>
        writePersistedFileSweepCursor({
          db,
          settingKey: MISSING_OBJECT_CURSOR_SETTING_KEY,
          cursor: parseFileSweepCursor(cursor ?? undefined) ?? null
        }));
    const getTerminalCleanupCursor =
      deps.getTerminalCleanupCursor ??
      (() =>
        readPersistedFileSweepCursor({
          db,
          settingKey: TERMINAL_CLEANUP_CURSOR_SETTING_KEY
        }).then((cursor) => serializeFileSweepCursor(cursor ?? null) ?? undefined));
    const setTerminalCleanupCursor =
      deps.setTerminalCleanupCursor ??
      ((cursor: string | null) =>
        writePersistedFileSweepCursor({
          db,
          settingKey: TERMINAL_CLEANUP_CURSOR_SETTING_KEY,
          cursor: parseFileSweepCursor(cursor ?? undefined) ?? null
        }));
    const getOrphanScanCursor = deps.getOrphanScanCursor ?? (() => loadOrphanScanCursor(db));
    const setOrphanScanCursor =
      deps.setOrphanScanCursor ?? ((cursor: string | null) => persistOrphanScanCursor(db, cursor));

    logger.info('Reconciliation started', {
      event: 'reconciliation.started',
      actor: 'worker',
      entity: { type: 'queue', id: 'reconcile' },
      outcome: 'success',
      olderThan: olderThan.toISOString()
    });

    const counters = {
      staleExpirationsFixed: 0,
      expireJobsRepaired: 0,
      pendingUploadsPromoted: 0,
      pendingUploadsRemoved: 0,
      missingObjectsDetected: 0,
      terminalCleanupEnqueued: 0,
      storageCheckFailures: 0,
      orphanScanFailures: 0,
      orphanedObjectsDetected: 0,
      lifecycleDuplicateJobGroups: 0,
      lifecycleDuplicateJobs: 0,
      lifecycleQueueScanFailures: 0,
      lifecycleQueueReadFailures: 0,
      anomaliesRecorded: 0
    };

    // ── Pass A: Fix stale expirations ─────────────────────────────────────────
    // Finds active/expiring files whose expires_at is in the past but whose
    // status was never updated (e.g., the delayed job was lost or never scheduled).
    const staleExpired = await db
      .select({
        id: files.id,
        objectKey: files.objectKey,
        expiresAt: files.expiresAt
      })
      .from(files)
      .where(
        and(
          inArray(files.status, ['active', 'expiring']),
          isNotNull(files.expiresAt),
          lt(files.expiresAt, olderThan)
        )
      )
      .orderBy(asc(files.expiresAt))
      .limit(STALE_EXPIRATION_BATCH_SIZE);

    for (const file of staleExpired) {
      // Compare-and-set: only update if still active/expiring.
      const [updated] = await db
        .update(files)
        .set({ status: 'expired' })
        .where(and(eq(files.id, file.id), inArray(files.status, ['active', 'expiring'])))
        .returning({ id: files.id });

      if (!updated) continue; // Race: already updated by another process

      counters.staleExpirationsFixed += 1;

      // Schedule cleanup. The deduplication jobId prevents double-queuing.
      await cleanupQueue.add(
        'cleanup-file',
        { fileId: file.id, objectKey: file.objectKey },
        {
          jobId: `cleanup:${file.id}`,
          attempts: 5,
          backoff: { type: 'exponential', delay: 1_000 },
          ...LIFECYCLE_JOB_RETENTION
        }
      );

      logger.info('Reconcile: fixed stale expiration', {
        event: 'reconciliation.anomaly_detected',
        actor: 'worker',
        entity: { type: 'file', id: file.id },
        outcome: 'success',
        anomalyType: 'stale_expiration',
        expiresAt: file.expiresAt?.toISOString()
      });

      // Only record a persistent anomaly for significantly overdue files
      // so the dashboard surfaces actionable issues, not normal catch-up runs.
      const overdueMs = olderThan.getTime() - (file.expiresAt?.getTime() ?? 0);
      if (overdueMs > STALE_EXPIRATION_ANOMALY_THRESHOLD_MS) {
        const inserted = await recordAnomalyIfAbsent(
          db,
          'stale_expiration',
          file.id,
          {
            expiresAt: file.expiresAt?.toISOString(),
            overdueMs
          },
          getAnomalySeverity('stale_expiration')
        );
        if (inserted) {
          counters.anomaliesRecorded += 1;
        }
      }
    }

    // ── Pass B: Repair missing future expiration jobs ───────────────────────
    // The upload flow schedules delayed expire jobs, but enqueue failures or
    // queue data loss must not leave future-expiring files without a job.
    const futureExpirationCursorState = await loadFileSweepCursorSafely({
      db,
      cursorName: 'future_expiration',
      getCursor: getFutureExpirationCursor,
      setCursor: setFutureExpirationCursor
    });
    counters.anomaliesRecorded += futureExpirationCursorState.anomaliesRecorded;
    const futureExpirationCursor = futureExpirationCursorState.cursor;
    const futureExpiring = await db
      .select({
        id: files.id,
        expiresAt: files.expiresAt,
        cursorTimestamp: files.expiresAt
      })
      .from(files)
      .where(
        withOptionalCursorCondition(
          and(
            inArray(files.status, ['active', 'expiring']),
            isNotNull(files.expiresAt),
            gt(files.expiresAt, olderThan)
          ) ?? gt(files.expiresAt, olderThan),
          buildFileSweepCursorCondition(files.expiresAt, futureExpirationCursor)
        )
      )
      .orderBy(asc(files.expiresAt), asc(files.id))
      .limit(FUTURE_EXPIRATION_BATCH_SIZE);

    for (const file of futureExpiring) {
      if (!file.expiresAt) continue;

      const delayMs = file.expiresAt.getTime() - Date.now();
      if (delayMs <= 0) continue;

      const jobId = `expire:${file.id}`;
      const existingJobLookup = await getLifecycleJobSafely({
        db,
        queue: expireQueue,
        queueName: 'expire-file',
        fileId: file.id,
        jobId
      });
      if (!existingJobLookup.ok) {
        counters.lifecycleQueueReadFailures += 1;
        if (existingJobLookup.anomalyRecorded) {
          counters.anomaliesRecorded += 1;
        }
        continue;
      }

      const existingJob = existingJobLookup.value;
      if (
        await shouldSkipRepairEnqueue({
          db,
          existingJob,
          queueName: 'expire-file',
          fileId: file.id
        })
      ) {
        continue;
      }

      await expireQueue.add(
        'expire-file',
        { fileId: file.id },
        {
          jobId,
          delay: delayMs,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          ...LIFECYCLE_JOB_RETENTION
        }
      );

      counters.expireJobsRepaired += 1;

      logger.info('Reconcile: repaired missing expire-file job', {
        event: 'reconciliation.anomaly_detected',
        actor: 'worker',
        entity: { type: 'file', id: file.id },
        outcome: 'success',
        anomalyType: 'missing_expire_job',
        resolution: 'expire_job_enqueued',
        expiresAt: file.expiresAt.toISOString()
      });
    }

    counters.anomaliesRecorded += await persistFileSweepCursorSafely({
      db,
      cursorName: 'future_expiration',
      setCursor: setFutureExpirationCursor,
      cursor: getNextFileSweepCursor(futureExpiring, FUTURE_EXPIRATION_BATCH_SIZE)
    });

    // ── Pass C: Handle stuck pending_upload records ─────────────────────────
    // Files stuck in pending_upload longer than the stale threshold have either
    // had their upload partially succeed (object exists → promote) or fail
    // outright (object absent → remove the dangling record).
    const staleCutoff = new Date(olderThan.getTime() - PENDING_UPLOAD_STALE_THRESHOLD_MS);

    const stuckPending = await db
      .select({
        id: files.id,
        objectKey: files.objectKey,
        expiresAt: files.expiresAt
      })
      .from(files)
      .where(and(eq(files.status, 'pending_upload'), lt(files.uploadedAt, staleCutoff)))
      .orderBy(asc(files.uploadedAt), asc(files.id))
      .limit(STUCK_PENDING_BATCH_SIZE);

    for (const file of stuckPending) {
      let objectExists: boolean;
      try {
        objectExists = await storage.exists(file.objectKey);
      } catch (err) {
        // Storage unavailable for this check — skip; next reconcile will retry.
        counters.storageCheckFailures += 1;
        const inserted = await logStorageCheckFailure({
          db,
          phase: 'stuck_pending',
          entity: { type: 'file', id: file.id },
          operation: 'exists',
          objectKey: file.objectKey,
          err
        });
        if (inserted) {
          counters.anomaliesRecorded += 1;
        }
        continue;
      }

      if (objectExists) {
        const now = new Date();
        const promoteToExpired = Boolean(file.expiresAt && file.expiresAt <= now);

        // Object is safely stored — promote the record to active when still
        // valid, or to expired when the pending record has already expired.
        const [updated] = await db
          .update(files)
          .set({
            status: promoteToExpired ? 'expired' : 'active',
            activatedAt: now
          })
          .where(and(eq(files.id, file.id), eq(files.status, 'pending_upload')))
          .returning({ id: files.id });

        if (!updated) continue; // Race

        counters.pendingUploadsPromoted += 1;

        logger.info('Reconcile: promoted stuck pending_upload', {
          event: 'reconciliation.anomaly_detected',
          actor: 'worker',
          entity: { type: 'file', id: file.id },
          outcome: 'success',
          anomalyType: 'stuck_pending',
          resolution: promoteToExpired ? 'promoted_to_expired' : 'promoted'
        });

        // Re-schedule expiration for promoted active records with future expiry.
        if (!promoteToExpired && file.expiresAt && file.expiresAt > now) {
          const delayMs = file.expiresAt.getTime() - Date.now();
          const jobId = `expire:${file.id}`;
          const existingJobLookup = await getLifecycleJobSafely({
            db,
            queue: expireQueue,
            queueName: 'expire-file',
            fileId: file.id,
            jobId
          });
          if (!existingJobLookup.ok) {
            counters.lifecycleQueueReadFailures += 1;
            if (existingJobLookup.anomalyRecorded) {
              counters.anomaliesRecorded += 1;
            }
            continue;
          }

          const existingJob = existingJobLookup.value;
          if (
            !(await shouldSkipRepairEnqueue({
              db,
              existingJob,
              queueName: 'expire-file',
              fileId: file.id
            }))
          ) {
            await expireQueue.add(
              'expire-file',
              { fileId: file.id },
              {
                jobId,
                delay: delayMs,
                attempts: 3,
                backoff: { type: 'exponential', delay: 5_000 },
                ...LIFECYCLE_JOB_RETENTION
              }
            );
          }
        }

        // If a stale pending record is already expired at promotion time,
        // enqueue cleanup immediately instead of waiting for the next cycle.
        if (promoteToExpired) {
          const cleanupJobId = `cleanup:${file.id}`;
          const existingCleanupJobLookup = await getLifecycleJobSafely({
            db,
            queue: cleanupQueue,
            queueName: 'cleanup-file',
            fileId: file.id,
            jobId: cleanupJobId
          });
          if (!existingCleanupJobLookup.ok) {
            counters.lifecycleQueueReadFailures += 1;
            if (existingCleanupJobLookup.anomalyRecorded) {
              counters.anomaliesRecorded += 1;
            }
            continue;
          }

          const existingCleanupJob = existingCleanupJobLookup.value;
          if (
            !(await shouldSkipRepairEnqueue({
              db,
              existingJob: existingCleanupJob,
              queueName: 'cleanup-file',
              fileId: file.id
            }))
          ) {
            await cleanupQueue.add(
              'cleanup-file',
              { fileId: file.id, objectKey: file.objectKey },
              {
                jobId: cleanupJobId,
                attempts: 5,
                backoff: { type: 'exponential', delay: 1_000 },
                ...LIFECYCLE_JOB_RETENTION
              }
            );
          }
        }
      } else {
        // No object in storage — compensate by removing the orphaned record.
        await db
          .delete(files)
          .where(and(eq(files.id, file.id), eq(files.status, 'pending_upload')));

        counters.pendingUploadsRemoved += 1;

        logger.info('Reconcile: removed stuck pending_upload without storage object', {
          event: 'reconciliation.anomaly_detected',
          actor: 'worker',
          entity: { type: 'file', id: file.id },
          outcome: 'success',
          anomalyType: 'stuck_pending',
          resolution: 'removed'
        });
      }
    }

    // ── Pass D: Detect active files with missing storage objects ────────────
    // Sample a bounded batch of active/expiring files and persist a cursor so
    // later runs continue from where the previous sweep stopped.
    const missingObjectCursorState = await loadFileSweepCursorSafely({
      db,
      cursorName: 'missing_object',
      getCursor: getMissingObjectCursor,
      setCursor: setMissingObjectCursor
    });
    counters.anomaliesRecorded += missingObjectCursorState.anomaliesRecorded;
    const missingObjectCursor = missingObjectCursorState.cursor;
    const activeBatch = await db
      .select({
        id: files.id,
        objectKey: files.objectKey,
        cursorTimestamp: files.uploadedAt
      })
      .from(files)
      .where(
        withOptionalCursorCondition(
          inArray(files.status, ['active', 'expiring']),
          buildFileSweepCursorCondition(files.uploadedAt, missingObjectCursor)
        )
      )
      .orderBy(asc(files.uploadedAt), asc(files.id))
      .limit(MISSING_OBJECT_BATCH_SIZE);

    for (const file of activeBatch) {
      let objectExists: boolean;
      try {
        objectExists = await storage.exists(file.objectKey);
      } catch (err) {
        counters.storageCheckFailures += 1;
        const inserted = await logStorageCheckFailure({
          db,
          phase: 'missing_object',
          entity: { type: 'file', id: file.id },
          operation: 'exists',
          objectKey: file.objectKey,
          err
        });
        if (inserted) {
          counters.anomaliesRecorded += 1;
        }
        continue;
      }

      if (!objectExists) {
        // Transition to `missing` so the public read layer blocks access,
        // and so the admin dashboard can surface the inconsistency.
        const [updated] = await db
          .update(files)
          .set({ status: 'missing' })
          .where(and(eq(files.id, file.id), inArray(files.status, ['active', 'expiring'])))
          .returning({ id: files.id });

        if (!updated) continue; // Race

        counters.missingObjectsDetected += 1;

        logger.warn('Reconcile: active file has missing storage object', {
          event: 'reconciliation.anomaly_detected',
          actor: 'worker',
          entity: { type: 'file', id: file.id },
          outcome: 'failure',
          anomalyType: 'missing_object',
          objectKey: file.objectKey
        });

        const inserted = await recordAnomalyIfAbsent(
          db,
          'missing_object',
          file.id,
          {
            objectKey: file.objectKey
          },
          getAnomalySeverity('missing_object')
        );
        if (inserted) {
          counters.anomaliesRecorded += 1;
        }
      }
    }

    counters.anomaliesRecorded += await persistFileSweepCursorSafely({
      db,
      cursorName: 'missing_object',
      setCursor: setMissingObjectCursor,
      cursor: getNextFileSweepCursor(activeBatch, MISSING_OBJECT_BATCH_SIZE)
    });

    // ── Pass E: Repair missing cleanup jobs for terminal files ──────────────
    // Expired, consumed, and deleted files should not retain their object.
    // If the object still exists and no cleanup job is queued, enqueue one.
    const terminalCleanupCursorState = await loadFileSweepCursorSafely({
      db,
      cursorName: 'terminal_cleanup',
      getCursor: getTerminalCleanupCursor,
      setCursor: setTerminalCleanupCursor
    });
    counters.anomaliesRecorded += terminalCleanupCursorState.anomaliesRecorded;
    const terminalCleanupCursor = terminalCleanupCursorState.cursor;
    const terminalFiles = await db
      .select({
        id: files.id,
        objectKey: files.objectKey,
        status: files.status,
        consumedAt: files.consumedAt,
        cursorTimestamp: files.uploadedAt
      })
      .from(files)
      .where(
        withOptionalCursorCondition(
          inArray(files.status, ['expired', 'consumed', 'deleted']),
          buildFileSweepCursorCondition(files.uploadedAt, terminalCleanupCursor)
        )
      )
      .orderBy(asc(files.uploadedAt), asc(files.id))
      .limit(TERMINAL_CLEANUP_BATCH_SIZE);

    for (const file of terminalFiles) {
      if (shouldDelayConsumedCleanup(file)) {
        continue;
      }

      let objectExists: boolean;
      try {
        objectExists = await storage.exists(file.objectKey);
      } catch (err) {
        counters.storageCheckFailures += 1;
        const inserted = await logStorageCheckFailure({
          db,
          phase: 'terminal_cleanup',
          entity: { type: 'file', id: file.id },
          operation: 'exists',
          objectKey: file.objectKey,
          err
        });
        if (inserted) {
          counters.anomaliesRecorded += 1;
        }
        continue;
      }

      if (!objectExists) continue;

      const cleanupJobId = `cleanup:${file.id}`;
      const existingCleanupJobLookup = await getLifecycleJobSafely({
        db,
        queue: cleanupQueue,
        queueName: 'cleanup-file',
        fileId: file.id,
        jobId: cleanupJobId
      });
      if (!existingCleanupJobLookup.ok) {
        counters.lifecycleQueueReadFailures += 1;
        if (existingCleanupJobLookup.anomalyRecorded) {
          counters.anomaliesRecorded += 1;
        }
        continue;
      }

      const existingCleanupJob = existingCleanupJobLookup.value;
      if (
        await shouldSkipRepairEnqueue({
          db,
          existingJob: existingCleanupJob,
          queueName: 'cleanup-file',
          fileId: file.id
        })
      ) {
        continue;
      }

      await cleanupQueue.add(
        'cleanup-file',
        { fileId: file.id, objectKey: file.objectKey },
        {
          jobId: cleanupJobId,
          attempts: 5,
          backoff: { type: 'exponential', delay: 1_000 },
          ...LIFECYCLE_JOB_RETENTION
        }
      );

      counters.terminalCleanupEnqueued += 1;

      logger.info('Reconcile: repaired missing cleanup job for terminal file', {
        event: 'reconciliation.anomaly_detected',
        actor: 'worker',
        entity: { type: 'file', id: file.id },
        outcome: 'success',
        anomalyType: 'terminal_object_present',
        resolution: 'cleanup_job_enqueued',
        status: file.status,
        objectKey: file.objectKey
      });
    }

    counters.anomaliesRecorded += await persistFileSweepCursorSafely({
      db,
      cursorName: 'terminal_cleanup',
      setCursor: setTerminalCleanupCursor,
      cursor: getNextFileSweepCursor(terminalFiles, TERMINAL_CLEANUP_BATCH_SIZE)
    });

    // ── Pass F: Detect orphaned storage objects without metadata ────────────
    // Orphaned objects are ambiguous and must be surfaced as anomalies rather
    // than auto-deleted. Keep the scan bounded to avoid long reconcile runs.
    let nextOrphanScanCursor: string | null = null;
    let shouldPersistOrphanScanCursor = false;

    try {
      let remainingObjectsToScan = ORPHANED_OBJECT_BATCH_SIZE;
      let startAfter = await getOrphanScanCursor();

      while (remainingObjectsToScan > 0) {
        const listedObjects = await storage.list({
          prefix: STORAGE_OBJECT_PREFIX,
          maxKeys: remainingObjectsToScan,
          ...(startAfter ? { startAfter } : {})
        });

        if (listedObjects.objects.length === 0) {
          nextOrphanScanCursor = null;
          break;
        }

        const knownObjects = await db
          .select({ objectKey: files.objectKey })
          .from(files)
          .where(
            inArray(
              files.objectKey,
              listedObjects.objects.map((object) => object.key)
            )
          );

        const knownKeys = new Set(knownObjects.map((row) => row.objectKey));

        for (const object of listedObjects.objects) {
          if (knownKeys.has(object.key)) continue;

          logger.warn('Reconcile: storage object has no metadata record', {
            event: 'reconciliation.anomaly_detected',
            actor: 'worker',
            entity: { type: 'storage_object', id: object.key },
            outcome: 'failure',
            anomalyType: 'orphaned_object',
            objectKey: object.key,
            sizeBytes: object.size
          });

          const inserted = await recordOrphanedObjectAnomalyIfAbsent(db, object);
          if (inserted) {
            counters.orphanedObjectsDetected += 1;
            counters.anomaliesRecorded += 1;
          }
        }

        remainingObjectsToScan -= listedObjects.objects.length;

        const nextStartAfter = listedObjects.nextStartAfter ?? undefined;

        if (listedObjects.isTruncated && !nextStartAfter) {
          counters.orphanScanFailures += 1;
          nextOrphanScanCursor = null;
          logger.warn('Reconcile: orphan scan truncated without continuation cursor', {
            event: 'reconciliation.anomaly_detected',
            actor: 'worker',
            entity: { type: 'queue', id: 'reconcile' },
            outcome: 'failure',
            anomalyType: 'orphaned_object_scan_incomplete',
            reason: 'missing_next_start_after',
            scannedObjects: ORPHANED_OBJECT_BATCH_SIZE - remainingObjectsToScan,
            listedObjects: listedObjects.objects.length
          });

          const inserted = await recordScopedAnomalyIfAbsent(
            db,
            'reconciliation_scan_incomplete',
            null,
            {
              queue: 'reconcile',
              reason: 'missing_next_start_after',
              scannedObjects: ORPHANED_OBJECT_BATCH_SIZE - remainingObjectsToScan,
              listedObjects: listedObjects.objects.length
            },
            getAnomalySeverity('reconciliation_scan_incomplete'),
            'reconcile:missing_next_start_after'
          );
          if (inserted) {
            counters.anomaliesRecorded += 1;
          }

          break;
        }

        if (!listedObjects.isTruncated) {
          nextOrphanScanCursor = null;
          break;
        }

        nextOrphanScanCursor = nextStartAfter ?? null;
        startAfter = nextStartAfter;
      }

      shouldPersistOrphanScanCursor = true;
    } catch (err) {
      // Storage list failed — leave orphan detection for the next run.
      counters.orphanScanFailures += 1;
      const inserted = await logStorageCheckFailure({
        db,
        phase: 'orphaned_object_scan',
        entity: { type: 'queue', id: 'reconcile' },
        operation: 'list',
        err
      });
      if (inserted) {
        counters.anomaliesRecorded += 1;
      }
    }

    if (shouldPersistOrphanScanCursor) {
      try {
        await setOrphanScanCursor(nextOrphanScanCursor);
      } catch (err) {
        counters.orphanScanFailures += 1;
        logger.warn('Reconcile: failed to persist orphan scan cursor', {
          event: 'reconciliation.anomaly_detected',
          actor: 'worker',
          entity: { type: 'queue', id: 'reconcile' },
          outcome: 'failure',
          anomalyType: 'orphaned_object_scan_cursor_failed',
          reason: 'cursor_write_failed',
          cursor: nextOrphanScanCursor,
          error: err instanceof Error ? err.message : String(err)
        });

        const inserted = await recordScopedAnomalyIfAbsent(
          db,
          'reconciliation_scan_incomplete',
          null,
          {
            queue: 'reconcile',
            reason: 'cursor_write_failed'
          },
          getAnomalySeverity('reconciliation_scan_incomplete'),
          'reconcile:cursor_write_failed'
        );
        if (inserted) {
          counters.anomaliesRecorded += 1;
        }
      }
    }

    // ── Pass G: Detect duplicate pending lifecycle jobs ─────────────────────
    // Dedup jobIds should prevent duplicates. If they still appear (manual
    // requeue or queue corruption), surface them explicitly for operators.
    const pendingStates: Array<
      'waiting' | 'active' | 'delayed' | 'prioritized' | 'waiting-children'
    > = ['waiting', 'active', 'delayed', 'prioritized', 'waiting-children'];

    for (const lifecycleQueue of [
      { name: 'expire-file' as const, queue: expireQueue },
      { name: 'cleanup-file' as const, queue: cleanupQueue }
    ]) {
      let pendingJobs: Array<{ id: unknown; data: { fileId?: string } }>;

      try {
        const queuedJobs = await withTimeout(
          lifecycleQueue.queue.getJobs(pendingStates, 0, LIFECYCLE_DUPLICATE_SCAN_LIMIT - 1),
          lifecycleQueue.name,
          'getJobs',
          LIFECYCLE_QUEUE_READ_TIMEOUT_MS
        );

        pendingJobs = queuedJobs.map((queuedJob) => ({
          id: queuedJob.id,
          data: queuedJob.data
        }));
      } catch (err) {
        counters.lifecycleQueueScanFailures += 1;

        const inserted = await recordQueueReadFailure({
          db,
          queueName: lifecycleQueue.name,
          fileId: null,
          operation: 'getJobs',
          err
        });
        if (inserted) {
          counters.anomaliesRecorded += 1;
        }

        continue;
      }

      const duplicateFileJobs = getDuplicateFileJobs(pendingJobs);

      for (const duplicateGroup of duplicateFileJobs) {
        counters.lifecycleDuplicateJobGroups += 1;
        counters.lifecycleDuplicateJobs += duplicateGroup.jobIds.length;

        logger.warn('Reconcile: duplicate lifecycle jobs detected for same file', {
          event: 'reconciliation.anomaly_detected',
          actor: 'worker',
          entity: { type: 'file', id: duplicateGroup.fileId },
          outcome: 'failure',
          anomalyType: 'lifecycle_job_duplicate',
          queue: lifecycleQueue.name,
          fileId: duplicateGroup.fileId,
          duplicateCount: duplicateGroup.jobIds.length,
          jobIds: duplicateGroup.jobIds
        });

        const inserted = await recordScopedAnomalyIfAbsent(
          db,
          'lifecycle_job_duplicate',
          duplicateGroup.fileId,
          {
            queue: lifecycleQueue.name,
            duplicateCount: duplicateGroup.jobIds.length,
            jobIds: duplicateGroup.jobIds
          },
          getAnomalySeverity('lifecycle_job_duplicate'),
          `${lifecycleQueue.name}:${duplicateGroup.fileId}:duplicate`
        );
        if (inserted) {
          counters.anomaliesRecorded += 1;
        }
      }
    }

    logger.info('Reconciliation completed', {
      event: 'reconciliation.completed',
      actor: 'worker',
      entity: { type: 'queue', id: 'reconcile' },
      outcome: 'success',
      durationMs: Date.now() - startedAtMs,
      ...counters
    });
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Insert an operational anomaly record only if no open (unresolved) anomaly
 * of the same type and file already exists. Prevents anomaly spam across
 * repeated reconcile calls for the same issue.
 */
async function recordAnomalyIfAbsent(
  db: ReturnType<typeof createDb>,
  type: 'stale_expiration' | 'missing_object',
  fileId: string,
  details: Record<string, unknown>,
  severity: OperationalAnomalySeverity
): Promise<boolean> {
  try {
    const existing = await db.query.operationalAnomalies.findFirst({
      where: and(
        eq(operationalAnomalies.type, type),
        eq(operationalAnomalies.fileId, fileId),
        isNull(operationalAnomalies.resolvedAt)
      )
    });

    if (!existing) {
      await db.insert(operationalAnomalies).values({
        type,
        fileId,
        details: withSeverity(details, severity)
      });
      return true;
    }
  } catch (err) {
    // Best-effort; anomaly recording failure must not abort reconciliation.
    logger.error('Reconcile: failed to record anomaly', {
      event: 'reconciliation.completed',
      actor: 'worker',
      entity: { type: 'file', id: fileId },
      outcome: 'failure',
      anomalyType: type,
      error: err instanceof Error ? err.message : String(err)
    });
  }

  return false;
}

async function recordOrphanedObjectAnomalyIfAbsent(
  db: ReturnType<typeof createDb>,
  object: {
    key: string;
    size: number;
    lastModified: Date | null;
  }
): Promise<boolean> {
  try {
    const existing = await db.query.operationalAnomalies.findFirst({
      where: and(
        eq(operationalAnomalies.type, 'orphaned_object'),
        isNull(operationalAnomalies.fileId),
        isNull(operationalAnomalies.resolvedAt),
        sql`${operationalAnomalies.details} ->> 'objectKey' = ${object.key}`
      )
    });

    if (existing) {
      return false;
    }

    await db.insert(operationalAnomalies).values({
      type: 'orphaned_object',
      fileId: null,
      details: withSeverity(
        {
          objectKey: object.key,
          sizeBytes: object.size,
          lastModified: object.lastModified?.toISOString() ?? null
        },
        getAnomalySeverity('orphaned_object')
      )
    });

    return true;
  } catch (err) {
    logger.error('Reconcile: failed to record orphaned object anomaly', {
      event: 'reconciliation.completed',
      actor: 'worker',
      entity: { type: 'storage_object', id: object.key },
      outcome: 'failure',
      anomalyType: 'orphaned_object',
      error: err instanceof Error ? err.message : String(err)
    });
    return false;
  }
}

async function recordScopedAnomalyIfAbsent(
  db: ReturnType<typeof createDb>,
  type: 'lifecycle_job_overdue' | 'lifecycle_job_duplicate' | 'reconciliation_scan_incomplete',
  fileId: string | null,
  details: Record<string, unknown>,
  severity: OperationalAnomalySeverity,
  fingerprint: string
): Promise<boolean> {
  try {
    const existing = await db.query.operationalAnomalies.findFirst({
      where: and(
        eq(operationalAnomalies.type, type),
        isNull(operationalAnomalies.resolvedAt),
        sql`${operationalAnomalies.details} ->> 'fingerprint' = ${fingerprint}`,
        fileId ? eq(operationalAnomalies.fileId, fileId) : isNull(operationalAnomalies.fileId)
      )
    });

    if (existing) {
      return false;
    }

    await db.insert(operationalAnomalies).values({
      type,
      fileId,
      details: withSeverity({ ...details, fingerprint }, severity)
    });

    return true;
  } catch (err) {
    logger.error('Reconcile: failed to record scoped anomaly', {
      event: 'reconciliation.completed',
      actor: 'worker',
      entity: fileId ? { type: 'file', id: fileId } : { type: 'queue', id: 'reconcile' },
      outcome: 'failure',
      anomalyType: type,
      error: err instanceof Error ? err.message : String(err)
    });
    return false;
  }
}
