import type { CleanupFileJobPayload } from '@anonshare/contracts';
import type { createDb } from '@anonshare/infrastructure/db';
import { files, operationalAnomalies } from '@anonshare/infrastructure/db/schema';
import { logger } from '@anonshare/infrastructure/logger';
import { StorageError, type storageAdapter } from '@anonshare/infrastructure/storage';
import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';

export type CleanupFileHandlerDeps = {
  db: ReturnType<typeof createDb>;
  storage: Pick<typeof storageAdapter, 'delete'>;
};

/**
 * Factory that produces a BullMQ processor function for cleanup-file jobs.
 *
 * Lifecycle:
 * 1. Verify the file is not active/expiring (admin may have restored it).
 * 2. Delete the storage object.
 *   - `not_found` → already deleted; treat as idempotent success.
 *   - `permanent` → retrying will not help; record a `failed_cleanup` anomaly.
 *   - `transient`  → rethrow so BullMQ retries; record anomaly on last attempt.
 *
 * Idempotent: safe to replay if a prior attempt partially succeeded.
 */
export function makeHandleCleanupFile(deps: CleanupFileHandlerDeps) {
  return async function handleCleanupFile(job: Job<CleanupFileJobPayload>): Promise<void> {
    const { fileId, objectKey } = job.data;
    const { db, storage } = deps;

    logger.info('Cleanup started', {
      event: 'file.cleanup_started',
      actor: 'worker',
      entity: { type: 'file', id: fileId },
      objectKey,
      outcome: 'success'
    });

    // Idempotency guard: skip cleanup if the file has been restored to an
    // active state (e.g., admin un-hid it between expiry and cleanup).
    const file = await db.query.files.findFirst({
      where: eq(files.id, fileId)
    });

    if (file && (file.status === 'active' || file.status === 'expiring')) {
      logger.info('cleanup-file: file restored to active state, skipping', {
        event: 'file.cleanup_started',
        actor: 'worker',
        entity: { type: 'file', id: fileId },
        objectKey,
        outcome: 'success',
        reason: 'file_restored'
      });
      return;
    }

    try {
      await storage.delete(objectKey);

      logger.info('Cleanup succeeded', {
        event: 'file.cleanup_succeeded',
        actor: 'worker',
        entity: { type: 'file', id: fileId },
        objectKey,
        outcome: 'success'
      });
    } catch (err) {
      if (err instanceof StorageError && err.kind === 'not_found') {
        // Object already absent — idempotent success
        logger.info('Cleanup: object already absent in storage', {
          event: 'file.cleanup_succeeded',
          actor: 'worker',
          entity: { type: 'file', id: fileId },
          objectKey,
          outcome: 'success',
          reason: 'object_already_absent'
        });
        return;
      }

      if (err instanceof StorageError && err.kind === 'permanent') {
        // Permanent failure: retrying won't help; record anomaly and do not rethrow.
        await recordFailedCleanupAnomaly(db, fileId, objectKey, err);
        logger.error('Cleanup failed permanently', {
          event: 'file.cleanup_failed',
          actor: 'worker',
          entity: { type: 'file', id: fileId },
          objectKey,
          outcome: 'failure',
          reason: 'permanent_storage_error',
          error: err.message
        });
        return;
      }

      // Transient error: record anomaly on the last attempt before exhausting retries.
      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (isLastAttempt) {
        await recordFailedCleanupAnomaly(db, fileId, objectKey, err);
      }

      logger.warn('Cleanup failed transiently — will retry', {
        event: 'file.cleanup_failed',
        actor: 'worker',
        entity: { type: 'file', id: fileId },
        objectKey,
        outcome: 'failure',
        reason: 'transient_storage_error',
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts ?? 1,
        error: err instanceof Error ? err.message : String(err)
      });

      throw err;
    }
  };
}

async function recordFailedCleanupAnomaly(
  db: ReturnType<typeof createDb>,
  fileId: string,
  objectKey: string,
  err: unknown
): Promise<void> {
  try {
    await db.insert(operationalAnomalies).values({
      type: 'failed_cleanup',
      fileId,
      details: {
        objectKey,
        error: err instanceof Error ? err.message : String(err)
      }
    });
  } catch (anomalyErr) {
    // Best-effort; anomaly recording must not swallow the real cleanup error.
    logger.error('Failed to record failed_cleanup anomaly', {
      event: 'file.cleanup_failed',
      actor: 'worker',
      entity: { type: 'file', id: fileId },
      outcome: 'failure',
      error: anomalyErr instanceof Error ? anomalyErr.message : String(anomalyErr)
    });
  }
}
