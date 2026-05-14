import { LIFECYCLE_JOB_RETENTION } from '@anonshare/contracts';
import { files } from '@anonshare/infrastructure/db/schema';
import { and, asc, gt, inArray, isNotNull } from 'drizzle-orm';
import { logger } from '../../logger';
import { FUTURE_EXPIRATION_BATCH_SIZE } from './constants';
import {
  buildFileSweepCursorCondition,
  getLifecycleJobSafely,
  getNextFileSweepCursor,
  loadFileSweepCursorSafely,
  persistFileSweepCursorSafely,
  shouldSkipRepairEnqueue,
  withOptionalCursorCondition
} from './helpers';
import type { ReconcileResolvedDeps } from './types';

/**
 * Pass B: Repair missing future expiration jobs.
 *
 * The upload flow schedules delayed expire jobs, but enqueue failures or queue
 * data loss must not leave future-expiring files without a job. Uses a cursor
 * for bounded pagination across repeated reconcile runs.
 */
export async function runPassB(ctx: ReconcileResolvedDeps): Promise<{
  expireJobsRepaired: number;
  lifecycleQueueReadFailures: number;
  anomaliesRecorded: number;
}> {
  const { db, expireQueue, olderThan, getFutureExpirationCursor, setFutureExpirationCursor } = ctx;
  let expireJobsRepaired = 0;
  let lifecycleQueueReadFailures = 0;
  let anomaliesRecorded = 0;

  const futureExpirationCursorState = await loadFileSweepCursorSafely({
    db,
    cursorName: 'future_expiration',
    getCursor: getFutureExpirationCursor,
    setCursor: setFutureExpirationCursor
  });
  anomaliesRecorded += futureExpirationCursorState.anomaliesRecorded;
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

    const jobId = `expire-${file.id}`;
    const existingJobLookup = await getLifecycleJobSafely({
      db,
      queue: expireQueue,
      queueName: 'expire-file',
      fileId: file.id,
      jobId
    });

    if (!existingJobLookup.ok) {
      lifecycleQueueReadFailures += 1;
      if (existingJobLookup.anomalyRecorded) {
        anomaliesRecorded += 1;
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

    expireJobsRepaired += 1;

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

  anomaliesRecorded += await persistFileSweepCursorSafely({
    db,
    cursorName: 'future_expiration',
    setCursor: setFutureExpirationCursor,
    cursor: getNextFileSweepCursor(futureExpiring, FUTURE_EXPIRATION_BATCH_SIZE)
  });

  return { expireJobsRepaired, lifecycleQueueReadFailures, anomaliesRecorded };
}
