import { LIFECYCLE_JOB_RETENTION } from '@anonshare/contracts';
import { files } from '@anonshare/infrastructure/db/schema';
import { and, asc, eq, lt } from 'drizzle-orm';
import { logger } from '../../logger';
import { PENDING_UPLOAD_STALE_THRESHOLD_MS, STUCK_PENDING_BATCH_SIZE } from './constants';
import { getLifecycleJobSafely, logStorageCheckFailure, shouldSkipRepairEnqueue } from './helpers';
import type { ReconcileResolvedDeps } from './types';

/**
 * Pass C: Handle stuck pending_upload records.
 *
 * Files stuck in `pending_upload` longer than the stale threshold have either
 * had their upload partially succeed (object exists → promote to active) or
 * fail outright (object absent → remove the dangling record).
 */
export async function runPassC(ctx: ReconcileResolvedDeps): Promise<{
  pendingUploadsPromoted: number;
  pendingUploadsRemoved: number;
  storageCheckFailures: number;
  lifecycleQueueReadFailures: number;
  anomaliesRecorded: number;
}> {
  const { db, storage, expireQueue, cleanupQueue, olderThan } = ctx;
  let pendingUploadsPromoted = 0;
  let pendingUploadsRemoved = 0;
  let storageCheckFailures = 0;
  let lifecycleQueueReadFailures = 0;
  let anomaliesRecorded = 0;

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
      storageCheckFailures += 1;
      const inserted = await logStorageCheckFailure({
        db,
        phase: 'stuck_pending',
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

      pendingUploadsPromoted += 1;

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
          lifecycleQueueReadFailures += 1;
          if (existingJobLookup.anomalyRecorded) {
            anomaliesRecorded += 1;
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
          lifecycleQueueReadFailures += 1;
          if (existingCleanupJobLookup.anomalyRecorded) {
            anomaliesRecorded += 1;
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
      await db.delete(files).where(and(eq(files.id, file.id), eq(files.status, 'pending_upload')));

      pendingUploadsRemoved += 1;

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

  return {
    pendingUploadsPromoted,
    pendingUploadsRemoved,
    storageCheckFailures,
    lifecycleQueueReadFailures,
    anomaliesRecorded
  };
}
