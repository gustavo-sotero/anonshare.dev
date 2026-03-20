import { redis as redisConfig } from '../config/index';

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
