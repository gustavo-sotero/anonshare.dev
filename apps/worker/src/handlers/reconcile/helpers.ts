import type { CleanupFileJobPayload, ExpireFileJobPayload } from '@anonshare/contracts';
import { ONE_TIME_DOWNLOAD_CLEANUP_DELAY_MS } from '@anonshare/contracts';
import type { OperationalAnomalySeverity } from '@anonshare/domain';
import type { createDb } from '@anonshare/infrastructure/db';
import { files, operationalAnomalies, systemSettings } from '@anonshare/infrastructure/db/schema';
import type { Queue } from 'bullmq';
import { and, eq, isNull, type SQL, sql } from 'drizzle-orm';
import { logger } from '../../logger';
import {
  LIFECYCLE_JOB_OVERDUE_THRESHOLD_MS,
  LIFECYCLE_QUEUE_READ_TIMEOUT_MS,
  ORPHAN_SCAN_CURSOR_SETTING_KEY,
  PENDING_QUEUE_JOB_STATES,
  QueueReadTimeoutError
} from './constants';
import type {
  FileSweepCursor,
  FileSweepCursorName,
  LifecycleRepairQueue,
  QueueLookupResult,
  ReconcileStorageFailurePhase
} from './types';

// ─── Anomaly severity ─────────────────────────────────────────────────────────

export function getAnomalySeverity(
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

export function withSeverity(
  details: Record<string, unknown>,
  severity: OperationalAnomalySeverity
): Record<string, unknown> {
  return { ...details, severity };
}

// ─── Anomaly recording ────────────────────────────────────────────────────────

/**
 * Insert an operational anomaly record only if no open (unresolved) anomaly
 * of the same type and file already exists. Prevents anomaly spam across
 * repeated reconcile calls for the same issue.
 */
export async function recordAnomalyIfAbsent(
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

export async function recordOrphanedObjectAnomalyIfAbsent(
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

export async function recordScopedAnomalyIfAbsent(
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

// ─── Storage failure logging ──────────────────────────────────────────────────

export async function logStorageCheckFailure(params: {
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

// ─── Queue helpers ────────────────────────────────────────────────────────────

export function isPendingQueueJobState(state: string): boolean {
  return PENDING_QUEUE_JOB_STATES.has(state);
}

export function withTimeout<T>(
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

export async function recordQueueReadFailure(params: {
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

export async function getLifecycleJobSafely(params: {
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

// ─── Cursor helpers ───────────────────────────────────────────────────────────

export function withOptionalCursorCondition(
  baseCondition: SQL<unknown>,
  cursorCondition: SQL<unknown> | undefined
): SQL<unknown> {
  if (!cursorCondition) {
    return baseCondition;
  }

  return and(baseCondition, cursorCondition) ?? baseCondition;
}

export function buildFileSweepCursorCondition(
  column: typeof files.uploadedAt | typeof files.expiresAt,
  cursor: FileSweepCursor | undefined
): SQL<unknown> | undefined {
  if (!cursor) {
    return undefined;
  }

  return sql`(${column}, ${files.id}) > (${cursor.timestamp.toISOString()}, ${cursor.id})`;
}

export function parseFileSweepCursor(rawCursor: string | undefined): FileSweepCursor | undefined {
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

export function serializeFileSweepCursor(cursor: FileSweepCursor | null): string | null {
  if (!cursor) {
    return null;
  }

  return `${cursor.timestamp.toISOString()}|${cursor.id}`;
}

export function getNextFileSweepCursor(
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

export async function readPersistedFileSweepCursor(params: {
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

export async function writePersistedFileSweepCursor(params: {
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

export async function recordLifecycleSweepCursorIssue(params: {
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

export async function loadFileSweepCursorSafely(params: {
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

export async function persistFileSweepCursorSafely(params: {
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

export async function loadOrphanScanCursor(
  db: ReturnType<typeof createDb>
): Promise<string | undefined> {
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

export async function persistOrphanScanCursor(
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

// ─── Misc helpers ─────────────────────────────────────────────────────────────

export function resolveOlderThan(rawOlderThan: string | undefined): Date {
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

export function getLifecycleJobOverdueMs(
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

export function toJobId(rawJobId: unknown): string {
  if (typeof rawJobId === 'string' || typeof rawJobId === 'number') {
    return String(rawJobId);
  }

  return 'unknown';
}

export function shouldDelayConsumedCleanup(file: {
  status: string;
  consumedAt?: Date | null;
}): boolean {
  if (file.status !== 'consumed' || !file.consumedAt) {
    return false;
  }

  return Date.now() - file.consumedAt.getTime() < ONE_TIME_DOWNLOAD_CLEANUP_DELAY_MS;
}

export function getDuplicateFileJobs(
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

export async function shouldSkipRepairEnqueue(params: {
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
