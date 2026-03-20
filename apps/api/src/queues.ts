import type {
  CleanupFileJobPayload,
  ExpireFileJobPayload,
  ReconcileJobPayload
} from '@anonshare/contracts';
import { LIFECYCLE_JOB_RETENTION } from '@anonshare/contracts';
import {
  createCleanupFileProducerQueue,
  createExpireFileProducerQueue,
  createReconcileProducerQueue
} from '@anonshare/infrastructure/queue';
import type { Queue } from 'bullmq';

let _expireQueue: Queue<ExpireFileJobPayload> | null = null;
let _cleanupQueue: Queue<CleanupFileJobPayload> | null = null;
let _reconcileQueue: Queue<ReconcileJobPayload> | null = null;

export function getExpireQueue(): Queue<ExpireFileJobPayload> {
  _expireQueue ??= createExpireFileProducerQueue();
  return _expireQueue;
}

export function getCleanupQueue(): Queue<CleanupFileJobPayload> {
  _cleanupQueue ??= createCleanupFileProducerQueue();
  return _cleanupQueue;
}

export function getReconcileQueue(): Queue<ReconcileJobPayload> {
  _reconcileQueue ??= createReconcileProducerQueue();
  return _reconcileQueue;
}

/**
 * Schedule a delayed expire-file job for a file after successful activation.
 *
 * Uses jobId deduplication (`expire:{fileId}`) so a given file can only have
 * one pending expiration job at a time. Calling this multiple times for the
 * same fileId is safe — BullMQ deduplicates by jobId.
 *
 * @param fileId  UUID of the file record.
 * @param delayMs Milliseconds from now until the job should run.
 */
export async function enqueueExpireFileJob(fileId: string, delayMs: number): Promise<void> {
  await getExpireQueue().add(
    'expire-file',
    { fileId },
    {
      jobId: `expire:${fileId}`,
      delay: delayMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      ...LIFECYCLE_JOB_RETENTION
    }
  );
}

/**
 * Schedule a cleanup-file job using the canonical deduplication key.
 * Re-enqueueing the same file is safe — BullMQ keeps only one pending jobId.
 */
export async function enqueueCleanupFileJob(
  fileId: string,
  objectKey: string,
  delayMs = 0
): Promise<void> {
  await getCleanupQueue().add(
    'cleanup-file',
    { fileId, objectKey },
    {
      jobId: `cleanup:${fileId}`,
      ...(delayMs > 0 ? { delay: delayMs } : {}),
      attempts: 5,
      backoff: { type: 'exponential', delay: 1_000 },
      ...LIFECYCLE_JOB_RETENTION
    }
  );
}
