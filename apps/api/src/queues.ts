import type {
  CleanupFileJobPayload,
  ExpireFileJobPayload,
  ReconcileJobPayload
} from '@anonshare/contracts';
import {
  LIFECYCLE_JOB_RETENTION,
  QUEUE_CLEANUP_FILE,
  QUEUE_EXPIRE_FILE,
  QUEUE_RECONCILE
} from '@anonshare/contracts';
import { redis as redisConfig } from '@anonshare/infrastructure/config';
import { Queue } from 'bullmq';

let _expireQueue: Queue<ExpireFileJobPayload> | null = null;
let _cleanupQueue: Queue<CleanupFileJobPayload> | null = null;
let _reconcileQueue: Queue<ReconcileJobPayload> | null = null;

export function getExpireQueue(): Queue<ExpireFileJobPayload> {
  if (!_expireQueue) {
    _expireQueue = new Queue<ExpireFileJobPayload>(QUEUE_EXPIRE_FILE, {
      connection: { url: redisConfig.url() }
    });
  }
  return _expireQueue;
}

export function getCleanupQueue(): Queue<CleanupFileJobPayload> {
  if (!_cleanupQueue) {
    _cleanupQueue = new Queue<CleanupFileJobPayload>(QUEUE_CLEANUP_FILE, {
      connection: { url: redisConfig.url() }
    });
  }
  return _cleanupQueue;
}

export function getReconcileQueue(): Queue<ReconcileJobPayload> {
  if (!_reconcileQueue) {
    _reconcileQueue = new Queue<ReconcileJobPayload>(QUEUE_RECONCILE, {
      connection: { url: redisConfig.url() }
    });
  }
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
