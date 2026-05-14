import {
  type CleanupFileJobPayload,
  type ExpireFileJobPayload,
  LIFECYCLE_JOB_RETENTION
} from '@anonshare/contracts';
import type { createDb } from '@anonshare/infrastructure/db';
import { files } from '@anonshare/infrastructure/db/schema';
import type { Job, Queue } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';
import { logger } from '../logger';

export type ExpireFileHandlerDeps = {
  db: ReturnType<typeof createDb>;
  cleanupQueue: Queue<CleanupFileJobPayload>;
};

async function enqueueCleanupJob(
  cleanupQueue: Queue<CleanupFileJobPayload>,
  fileId: string,
  objectKey: string
): Promise<void> {
  await cleanupQueue.add(
    'cleanup-file',
    { fileId, objectKey },
    {
      jobId: `cleanup-${fileId}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 1_000 },
      ...LIFECYCLE_JOB_RETENTION
    }
  );
}

/**
 * Factory that produces a BullMQ processor function for expire-file jobs.
 *
 * Lifecycle:
 * 1. Fetch the current file record to verify it is still in an expirable state.
 * 2. Confirm that `expires_at` has actually passed (safety net against premature delivery).
 * 3. Atomically transition `active|expiring` → `expired` via a compare-and-set UPDATE.
 * 4. Enqueue a deduplication-keyed cleanup job so the storage object is removed.
 *
 * Idempotent: if the file is already in a terminal state (or missing), returns
 * without error so that duplicate or replayed jobs do not cause issues.
 */
export function makeHandleExpireFile(deps: ExpireFileHandlerDeps) {
  return async function handleExpireFile(job: Job<ExpireFileJobPayload>): Promise<void> {
    const { fileId } = job.data;
    const { db, cleanupQueue } = deps;

    const file = await db.query.files.findFirst({ where: eq(files.id, fileId) });

    if (!file) {
      logger.info('expire-file: file not found, skipping', {
        event: 'file.expired',
        actor: 'worker',
        entity: { type: 'file', id: fileId },
        outcome: 'success',
        reason: 'file_not_found'
      });
      return;
    }

    // If a prior attempt already transitioned the file to expired but failed
    // while enqueueing cleanup, retries must still try to enqueue cleanup.
    if (file.status === 'expired') {
      await enqueueCleanupJob(cleanupQueue, fileId, file.objectKey);

      logger.info('expire-file: file already expired, ensured cleanup enqueue', {
        event: 'file.expired',
        actor: 'worker',
        entity: { type: 'file', id: fileId },
        outcome: 'success',
        reason: 'already_expired_cleanup_enqueued'
      });
      return;
    }

    // Idempotent: already in a terminal or moderated state that should not be
    // changed by the expire-file worker.
    if (file.status !== 'active' && file.status !== 'expiring') {
      logger.info('expire-file: file not in expirable state, skipping', {
        event: 'file.expired',
        actor: 'worker',
        entity: { type: 'file', id: fileId },
        outcome: 'success',
        reason: 'not_expirable',
        currentStatus: file.status
      });
      return;
    }

    // Safety net: the delayed job should only fire after expires_at, but guard
    // against early delivery or missing expiration configuration.
    if (!file.expiresAt || file.expiresAt > new Date()) {
      logger.warn('expire-file: expiresAt not reached or missing, skipping', {
        event: 'file.expired',
        actor: 'worker',
        entity: { type: 'file', id: fileId },
        outcome: 'failure',
        reason: 'not_yet_expired',
        expiresAt: file.expiresAt?.toISOString() ?? null
      });
      return;
    }

    // Atomically transition active|expiring → expired.
    // If another process already updated the record, the WHERE clause will match
    // zero rows and we skip cleanly (idempotent).
    const [updated] = await db
      .update(files)
      .set({ status: 'expired' })
      .where(and(eq(files.id, fileId), inArray(files.status, ['active', 'expiring'])))
      .returning({ id: files.id });

    if (!updated) {
      logger.info('expire-file: status already changed concurrently, skipping', {
        event: 'file.expired',
        actor: 'worker',
        entity: { type: 'file', id: fileId },
        outcome: 'success',
        reason: 'concurrent_status_change'
      });
      return;
    }

    logger.info('File expired', {
      event: 'file.expired',
      actor: 'worker',
      entity: { type: 'file', id: fileId },
      outcome: 'success',
      objectKey: file.objectKey
    });

    // Schedule cleanup with a deduplication jobId to prevent double-deletion
    // even if this handler is replayed.
    await enqueueCleanupJob(cleanupQueue, fileId, file.objectKey);
  };
}
