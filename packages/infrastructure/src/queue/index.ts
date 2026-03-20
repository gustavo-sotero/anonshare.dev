import type {
  CleanupFileJobPayload,
  ExpireFileJobPayload,
  ReconcileJobPayload
} from '@anonshare/contracts';
import { QUEUE_CLEANUP_FILE, QUEUE_EXPIRE_FILE, QUEUE_RECONCILE } from '@anonshare/contracts';
import type { Processor, QueueOptions, WorkerOptions } from 'bullmq';
import { Queue, Worker } from 'bullmq';
import { redis as redisConfig } from '../config/index';

type QueueConnectionRole = 'producer' | 'worker';

function getQueueConnectionConfig(role: QueueConnectionRole): { url: string } {
  return role === 'worker' ? getWorkerConnectionConfig() : getProducerConnectionConfig();
}

/**
 * Standard BullMQ connection options for HTTP-facing producer processes (API).
 *
 * Producers create Queue instances to enqueue jobs. They:
 * - share the Redis URL from the canonical config
 * - keep `maxRetriesPerRequest` at null (BullMQ requirement)
 * - do not need aggressive reconnect behavior since jobs are enqueued
 *   opportunistically and failures are tolerable/retriable at the caller
 */
export function getProducerConnectionConfig(): { url: string } {
  return { url: redisConfig.url() };
}

/**
 * Standard BullMQ connection options for worker processes.
 *
 * Workers create Worker instances that consume jobs. They:
 * - share the Redis URL from the canonical config
 * - need their own connection (BullMQ recommends separate connections per client)
 * - use default BullMQ reconnect behavior which is suitable for long-running workers
 */
export function getWorkerConnectionConfig(): { url: string } {
  return { url: redisConfig.url() };
}

export function createProducerQueue<DataType>(
  name: string,
  options: Omit<QueueOptions, 'connection'> = {}
): Queue<DataType, unknown, string> {
  return new Queue<DataType, unknown, string>(name, {
    ...options,
    connection: getQueueConnectionConfig('producer')
  });
}

export function createWorkerQueue<DataType>(
  name: string,
  options: Omit<QueueOptions, 'connection'> = {}
): Queue<DataType, unknown, string> {
  return new Queue<DataType, unknown, string>(name, {
    ...options,
    connection: getQueueConnectionConfig('worker')
  });
}

export function createQueueWorker<DataType, ResultType = void, NameType extends string = string>(
  name: NameType,
  processor: Processor<DataType, ResultType, NameType>,
  options: Omit<WorkerOptions, 'connection'> = {}
): Worker<DataType, ResultType, NameType> {
  return new Worker<DataType, ResultType, NameType>(name, processor, {
    ...options,
    connection: getQueueConnectionConfig('worker')
  });
}

export function createExpireFileProducerQueue(
  options: Omit<QueueOptions, 'connection'> = {}
): Queue<ExpireFileJobPayload, unknown, string> {
  return createProducerQueue<ExpireFileJobPayload>(QUEUE_EXPIRE_FILE, options);
}

export function createCleanupFileProducerQueue(
  options: Omit<QueueOptions, 'connection'> = {}
): Queue<CleanupFileJobPayload, unknown, string> {
  return createProducerQueue<CleanupFileJobPayload>(QUEUE_CLEANUP_FILE, options);
}

export function createReconcileProducerQueue(
  options: Omit<QueueOptions, 'connection'> = {}
): Queue<ReconcileJobPayload, unknown, string> {
  return createProducerQueue<ReconcileJobPayload>(QUEUE_RECONCILE, options);
}

export function createExpireFileWorkerQueue(
  options: Omit<QueueOptions, 'connection'> = {}
): Queue<ExpireFileJobPayload, unknown, string> {
  return createWorkerQueue<ExpireFileJobPayload>(QUEUE_EXPIRE_FILE, options);
}

export function createCleanupFileWorkerQueue(
  options: Omit<QueueOptions, 'connection'> = {}
): Queue<CleanupFileJobPayload, unknown, string> {
  return createWorkerQueue<CleanupFileJobPayload>(QUEUE_CLEANUP_FILE, options);
}

export function createReconcileWorkerQueue(
  options: Omit<QueueOptions, 'connection'> = {}
): Queue<ReconcileJobPayload, unknown, string> {
  return createWorkerQueue<ReconcileJobPayload>(QUEUE_RECONCILE, options);
}
