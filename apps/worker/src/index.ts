import type {
  CleanupFileJobPayload,
  ExpireFileJobPayload,
  ReconcileJobPayload
} from '@anonshare/contracts';
import { validateWorkerEnv } from '@anonshare/infrastructure/config';
import { createDb } from '@anonshare/infrastructure/db';
import { logger } from '@anonshare/infrastructure/logger';
import { closeRedisClient } from '@anonshare/infrastructure/redis';
import { storageAdapter } from '@anonshare/infrastructure/storage';
import { Queue, Worker } from 'bullmq';
import { makeHandleCleanupFile } from './handlers/cleanup-file';
import { makeHandleExpireFile } from './handlers/expire-file';
import { makeHandleReconcile } from './handlers/reconcile';
import { QUEUE_CLEANUP_FILE, QUEUE_EXPIRE_FILE, QUEUE_RECONCILE } from './queues';

function getJobLagMs(job: { timestamp?: number; delay?: number; processedOn?: number }): number {
  const scheduledAt = (job.timestamp ?? Date.now()) + (job.delay ?? 0);
  const processedAt = job.processedOn ?? Date.now();
  return Math.max(0, processedAt - scheduledAt);
}

function getJobDurationMs(job: { processedOn?: number; finishedOn?: number }): number | null {
  if (typeof job.processedOn !== 'number' || typeof job.finishedOn !== 'number') {
    return null;
  }

  return Math.max(0, job.finishedOn - job.processedOn);
}

// ─── Boot ────────────────────────────────────────────────────────────────────

logger.info('Worker starting', { actor: 'worker', event: 'worker_start', outcome: 'success' });

const config = validateWorkerEnv();

// Pass the URL directly so BullMQ creates its own ioredis connection,
// avoiding version-mismatch conflicts with the infrastructure package's client.
const connection = { url: config.redisUrl };

// ─── Shared dependencies ──────────────────────────────────────────────────────

const db = createDb();

// ─── Queues (producers used by handlers) ─────────────────────────────────────

const expireQueue = new Queue<ExpireFileJobPayload>(QUEUE_EXPIRE_FILE, { connection });
const cleanupQueue = new Queue<CleanupFileJobPayload>(QUEUE_CLEANUP_FILE, { connection });
const reconcileQueue = new Queue<ReconcileJobPayload>(QUEUE_RECONCILE, { connection });

// ─── Workers ─────────────────────────────────────────────────────────────────

const expireWorker = new Worker(QUEUE_EXPIRE_FILE, makeHandleExpireFile({ db, cleanupQueue }), {
  connection,
  concurrency: 5
});

const cleanupWorker = new Worker(
  QUEUE_CLEANUP_FILE,
  makeHandleCleanupFile({ db, storage: storageAdapter }),
  { connection, concurrency: 5 }
);

const reconcileWorker = new Worker(
  QUEUE_RECONCILE,
  makeHandleReconcile({ db, storage: storageAdapter, cleanupQueue, expireQueue }),
  { connection, concurrency: 1 }
);

await Promise.all([
  expireQueue.waitUntilReady(),
  cleanupQueue.waitUntilReady(),
  reconcileQueue.waitUntilReady(),
  expireWorker.waitUntilReady(),
  cleanupWorker.waitUntilReady(),
  reconcileWorker.waitUntilReady()
]);

// ─── Recurring reconciliation scheduler ──────────────────────────────────────

await reconcileQueue.upsertJobScheduler(
  'reconcile-periodic',
  { every: 60 * 60 * 1000 }, // every hour
  { name: 'reconcile', data: {} }
);

logger.info('Reconciliation scheduler registered', {
  actor: 'worker',
  event: 'reconcile_scheduler_registered',
  entity: { type: 'queue', id: QUEUE_RECONCILE },
  outcome: 'success'
});

// ─── Error logging ────────────────────────────────────────────────────────────

for (const worker of [expireWorker, cleanupWorker, reconcileWorker]) {
  worker.on('completed', (job) => {
    logger.info('Job completed', {
      actor: 'worker',
      event: 'job_completed',
      ...(job ? { entity: { type: 'job', id: job.id ?? 'unknown' } } : {}),
      outcome: 'success',
      queue: worker.name,
      jobName: job?.name,
      attemptsMade: job?.attemptsMade ?? 0,
      lagMs: job ? getJobLagMs(job) : null,
      durationMs: job ? getJobDurationMs(job) : null
    });
  });

  worker.on('failed', (job, err) => {
    logger.error('Job failed', {
      actor: 'worker',
      event: 'job_failed',
      ...(job ? { entity: { type: 'job', id: job.id ?? 'unknown' } } : {}),
      outcome: 'failure',
      queue: worker.name,
      jobName: job?.name,
      attemptsMade: job?.attemptsMade ?? 0,
      lagMs: job ? getJobLagMs(job) : null,
      durationMs: job ? getJobDurationMs(job) : null,
      error: String(err)
    });
  });
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(): Promise<void> {
  logger.info('Worker shutting down', {
    actor: 'worker',
    event: 'worker_shutdown',
    outcome: 'success'
  });
  await Promise.all([
    expireWorker.close(),
    cleanupWorker.close(),
    reconcileWorker.close(),
    expireQueue.close(),
    cleanupQueue.close(),
    reconcileQueue.close()
  ]);
  await closeRedisClient();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

logger.info('Worker ready', { actor: 'worker', event: 'worker_ready', outcome: 'success' });
