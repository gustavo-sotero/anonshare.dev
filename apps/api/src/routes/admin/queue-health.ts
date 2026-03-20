import { logger } from '../../logger';
import { computeQueueLagMs, computeQueueProcessingSummary, normalizeQueueName } from './helpers';
import type { QueueHealthStatus, QueueStatsReader } from './types';
import { QUEUE_READ_TIMEOUT_MS } from './types';

class QueueReadTimeoutError extends Error {
  constructor(queueName: string, operation: string, timeoutMs: number) {
    super(`${queueName} ${operation} timed out after ${timeoutMs}ms`);
    this.name = 'QueueReadTimeoutError';
  }
}

function withTimeout<T>(
  operation: Promise<T>,
  queueName: string,
  operationName: string,
  timeoutMs: number
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new QueueReadTimeoutError(queueName, operationName, timeoutMs));
    }, timeoutMs);

    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function readQueueMetric<T>(params: {
  queue: QueueStatsReader;
  requestId: string;
  operation: 'getJobCounts' | 'getWaiting' | 'getDelayed' | 'getJobs';
  read: () => Promise<T>;
  fallback: T;
}): Promise<{ value: T; degraded: boolean; error: string | null }> {
  try {
    const value = await withTimeout(
      params.read(),
      params.queue.name,
      params.operation,
      QUEUE_READ_TIMEOUT_MS
    );

    return { value, degraded: false, error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);

    logger.warn('Admin queue health read degraded', {
      event: 'admin_queue_health_degraded',
      requestId: params.requestId,
      actor: 'admin',
      entity: { type: 'queue', id: params.queue.name },
      outcome: 'failure',
      operation: params.operation,
      reason: err instanceof QueueReadTimeoutError ? 'timeout' : 'queue_read_failed',
      error
    });

    return {
      value: params.fallback,
      degraded: true,
      error
    };
  }
}

export async function buildQueueHealthSnapshot(
  queue: QueueStatsReader,
  nowMs: number,
  requestId: string
) {
  const [countsResult, waitingResult, delayedResult, jobsResult] = await Promise.all([
    readQueueMetric({
      queue,
      requestId,
      operation: 'getJobCounts',
      read: () => queue.getJobCounts(),
      fallback: {}
    }),
    readQueueMetric({
      queue,
      requestId,
      operation: 'getWaiting',
      read: () => queue.getWaiting(0, 0),
      fallback: []
    }),
    readQueueMetric({
      queue,
      requestId,
      operation: 'getDelayed',
      read: () => queue.getDelayed(0, 0),
      fallback: []
    }),
    readQueueMetric({
      queue,
      requestId,
      operation: 'getJobs',
      read: () => queue.getJobs(['completed', 'failed'], 0, 49),
      fallback: []
    })
  ]);

  const counts = countsResult.value;
  const waitingJobs = waitingResult.value;
  const delayedJobs = delayedResult.value;
  const recentJobs = jobsResult.value;
  const degraded =
    countsResult.degraded ||
    waitingResult.degraded ||
    delayedResult.degraded ||
    jobsResult.degraded;
  const lastError =
    countsResult.error ?? waitingResult.error ?? delayedResult.error ?? jobsResult.error ?? null;

  return {
    queue: normalizeQueueName(queue.name),
    status: degraded
      ? ('degraded' satisfies QueueHealthStatus)
      : ('healthy' satisfies QueueHealthStatus),
    lastError,
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    failed: counts.failed ?? 0,
    completed: counts.completed ?? 0,
    lagMs: computeQueueLagMs(waitingJobs, delayedJobs, nowMs),
    processing: computeQueueProcessingSummary(recentJobs)
  };
}
