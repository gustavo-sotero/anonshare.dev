import type { ExpireFileJobPayload } from '@anonshare/contracts';
import { QUEUE_EXPIRE_FILE } from '@anonshare/contracts';
import { redis as redisConfig } from '@anonshare/infrastructure/config';
import { Queue } from 'bullmq';

let _expireQueue: Queue<ExpireFileJobPayload> | null = null;

function getExpireQueue(): Queue<ExpireFileJobPayload> {
  if (!_expireQueue) {
    _expireQueue = new Queue<ExpireFileJobPayload>(QUEUE_EXPIRE_FILE, {
      connection: { url: redisConfig.url() }
    });
  }
  return _expireQueue;
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
      backoff: { type: 'exponential', delay: 5_000 }
    }
  );
}
