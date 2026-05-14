import { LIFECYCLE_JOB_RETENTION } from '@anonshare/contracts';
import { files } from '@anonshare/infrastructure/db/schema';
import { asc, inArray } from 'drizzle-orm';
import { logger } from '../../logger';
import { TERMINAL_CLEANUP_BATCH_SIZE } from './constants';
import {
  buildFileSweepCursorCondition,
  getLifecycleJobSafely,
  getNextFileSweepCursor,
  loadFileSweepCursorSafely,
  logStorageCheckFailure,
  persistFileSweepCursorSafely,
  shouldDelayConsumedCleanup,
  shouldSkipRepairEnqueue,
  withOptionalCursorCondition
} from './helpers';
import type { ReconcileResolvedDeps } from './types';

/**
 * Pass E: Repair missing cleanup jobs for terminal files.
 *
 * Expired, consumed, and deleted files should not retain their storage object.
 * If the object still exists and no cleanup job is queued, enqueue one. Uses
 * a cursor for bounded pagination across repeated reconcile runs.
 */
export async function runPassE(ctx: ReconcileResolvedDeps): Promise<{
  terminalCleanupEnqueued: number;
  storageCheckFailures: number;
  lifecycleQueueReadFailures: number;
  anomaliesRecorded: number;
}> {
  const { db, storage, cleanupQueue, getTerminalCleanupCursor, setTerminalCleanupCursor } = ctx;
  let terminalCleanupEnqueued = 0;
  let storageCheckFailures = 0;
  let lifecycleQueueReadFailures = 0;
  let anomaliesRecorded = 0;

  const terminalCleanupCursorState = await loadFileSweepCursorSafely({
    db,
    cursorName: 'terminal_cleanup',
    getCursor: getTerminalCleanupCursor,
    setCursor: setTerminalCleanupCursor
  });
  anomaliesRecorded += terminalCleanupCursorState.anomaliesRecorded;
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
      storageCheckFailures += 1;
      const inserted = await logStorageCheckFailure({
        db,
        phase: 'terminal_cleanup',
        entity: { type: 'file', id: file.id },
        operation: 'exists',
        objectKey: file.objectKey,
        err
      });
      if (inserted) {
        anomaliesRecorded += 1;
      }
      continue;
    }

    if (!objectExists) continue;

    const cleanupJobId = `cleanup-${file.id}`;
    const existingCleanupJobLookup = await getLifecycleJobSafely({
      db,
      queue: cleanupQueue,
      queueName: 'cleanup-file',
      fileId: file.id,
      jobId: cleanupJobId
    });

    if (!existingCleanupJobLookup.ok) {
      lifecycleQueueReadFailures += 1;
      if (existingCleanupJobLookup.anomalyRecorded) {
        anomaliesRecorded += 1;
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

    terminalCleanupEnqueued += 1;

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

  anomaliesRecorded += await persistFileSweepCursorSafely({
    db,
    cursorName: 'terminal_cleanup',
    setCursor: setTerminalCleanupCursor,
    cursor: getNextFileSweepCursor(terminalFiles, TERMINAL_CLEANUP_BATCH_SIZE)
  });

  return {
    terminalCleanupEnqueued,
    storageCheckFailures,
    lifecycleQueueReadFailures,
    anomaliesRecorded
  };
}
