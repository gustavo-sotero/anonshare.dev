import type {
  CleanupFileJobPayload,
  ExpireFileJobPayload,
  ReconcileJobPayload
} from '@anonshare/contracts';
import { validateWorkerEnv } from '@anonshare/infrastructure/config';
import { createDb } from '@anonshare/infrastructure/db';
import {
  createCleanupFileWorkerQueue,
  createExpireFileWorkerQueue,
  createQueueWorker,
  createReconcileWorkerQueue
} from '@anonshare/infrastructure/queue';
import { closeRedisClient } from '@anonshare/infrastructure/redis';
import { storageAdapter } from '@anonshare/infrastructure/storage';
import type { Job } from 'bullmq';
import { registerReconcileScheduler } from './bootstrap/register-reconcile-scheduler';
import { makeHandleCleanupFile } from './handlers/cleanup-file';
import { makeHandleExpireFile } from './handlers/expire-file';
import { makeHandleReconcile } from './handlers/reconcile';
import { startWorkerHealthServer } from './health-server';
import { logger } from './logger';
import { QUEUE_CLEANUP_FILE, QUEUE_EXPIRE_FILE, QUEUE_RECONCILE } from './queues';
import { buildWorkerJobLogContext, buildWorkerLifecycleLog } from './runtime-events';

// ─── Boot ────────────────────────────────────────────────────────────────────

logger.info('Worker starting', buildWorkerLifecycleLog('worker_start'));

const config = validateWorkerEnv();
const runtimeHealthState = {
  queueNames: [QUEUE_EXPIRE_FILE, QUEUE_CLEANUP_FILE, QUEUE_RECONCILE],
  ready: false,
  shuttingDown: false
};
const healthServer = startWorkerHealthServer({
  getState: () => runtimeHealthState,
  port: config.healthPort
});

// ─── Shared dependencies ──────────────────────────────────────────────────────

const db = createDb();

// ─── Queues (producers used by handlers) ─────────────────────────────────────

const expireQueue = createExpireFileWorkerQueue();
const cleanupQueue = createCleanupFileWorkerQueue();
const reconcileQueue = createReconcileWorkerQueue();

// ─── Workers ─────────────────────────────────────────────────────────────────

const expireWorker = createQueueWorker<ExpireFileJobPayload>(
  QUEUE_EXPIRE_FILE,
  makeHandleExpireFile({ db, cleanupQueue }),
  {
    concurrency: 5
  }
);

const cleanupWorker = createQueueWorker<CleanupFileJobPayload>(
  QUEUE_CLEANUP_FILE,
  makeHandleCleanupFile({ db, storage: storageAdapter }),
  { concurrency: 5 }
);

const reconcileWorker = createQueueWorker<ReconcileJobPayload>(
  QUEUE_RECONCILE,
  makeHandleReconcile({ db, storage: storageAdapter, cleanupQueue, expireQueue }),
  { concurrency: 1 }
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

await registerReconcileScheduler(reconcileQueue);
runtimeHealthState.ready = true;

// ─── Error logging ────────────────────────────────────────────────────────────

for (const worker of [expireWorker, cleanupWorker, reconcileWorker]) {
  worker.on('completed', (job: Job | undefined) => {
    logger.info(
      'Job completed',
      buildWorkerJobLogContext({ event: 'job_completed', job, queue: worker.name })
    );
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error(
      'Job failed',
      buildWorkerJobLogContext({
        error: String(err),
        event: 'job_failed',
        job,
        queue: worker.name
      })
    );
  });
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(): Promise<void> {
  runtimeHealthState.ready = false;
  runtimeHealthState.shuttingDown = true;
  logger.info('Worker shutting down', buildWorkerLifecycleLog('worker_shutdown'));
  await Promise.all([
    expireWorker.close(),
    cleanupWorker.close(),
    reconcileWorker.close(),
    expireQueue.close(),
    cleanupQueue.close(),
    reconcileQueue.close()
  ]);
  healthServer.stop(true);
  await closeRedisClient();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

logger.info('Worker ready', buildWorkerLifecycleLog('worker_ready'));
