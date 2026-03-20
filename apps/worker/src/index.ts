import type {
  CleanupFileJobPayload,
  ExpireFileJobPayload,
  ReconcileJobPayload
} from '@anonshare/contracts';
import { validateWorkerEnv } from '@anonshare/infrastructure/config';
import { createDb } from '@anonshare/infrastructure/db';
import { getWorkerConnectionConfig } from '@anonshare/infrastructure/queue';
import { closeRedisClient } from '@anonshare/infrastructure/redis';
import { storageAdapter } from '@anonshare/infrastructure/storage';
import { Queue, Worker } from 'bullmq';
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

// Use canonical worker connection config from infrastructure so all worker
// processes share the same connection policy. BullMQ creates its own ioredis
// connection from the URL, avoiding version-mismatch conflicts with the
// infrastructure package's shared client.
const connection = getWorkerConnectionConfig();

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

await registerReconcileScheduler(reconcileQueue);
runtimeHealthState.ready = true;

// ─── Error logging ────────────────────────────────────────────────────────────

for (const worker of [expireWorker, cleanupWorker, reconcileWorker]) {
  worker.on('completed', (job) => {
    logger.info(
      'Job completed',
      buildWorkerJobLogContext({ event: 'job_completed', job, queue: worker.name })
    );
  });

  worker.on('failed', (job, err) => {
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
