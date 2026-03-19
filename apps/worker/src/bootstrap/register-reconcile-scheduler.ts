import {
  LIFECYCLE_JOB_RETENTION,
  RECONCILE_JOB_ATTEMPTS,
  RECONCILE_JOB_BACKOFF_DELAY_MS,
  type ReconcileJobPayload
} from '@anonshare/contracts';
import type { Queue } from 'bullmq';
import { logger } from '../logger';
import { QUEUE_RECONCILE } from '../queues';

const DEFAULT_INTERVAL_MS = 60 * 60 * 1_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const SCHEDULER_ID = 'reconcile-periodic';

type ReconcileSchedulerQueue = Pick<Queue<ReconcileJobPayload>, 'upsertJobScheduler'>;

type RegisterReconcileSchedulerOptions = {
  intervalMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Re-register the recurring reconcile scheduler on every worker startup.
 * BullMQ's upsert API is idempotent, so repeated calls are safe. A short
 * retry window avoids failing the whole worker on brief Redis hiccups during
 * bootstrap while still surfacing persistent startup issues.
 */
export async function registerReconcileScheduler(
  queue: ReconcileSchedulerQueue,
  options: RegisterReconcileSchedulerOptions = {}
): Promise<void> {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
  const sleep = options.sleep ?? wait;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await queue.upsertJobScheduler(
        SCHEDULER_ID,
        { every: intervalMs },
        {
          name: 'reconcile',
          data: {},
          opts: {
            attempts: RECONCILE_JOB_ATTEMPTS,
            backoff: { type: 'exponential', delay: RECONCILE_JOB_BACKOFF_DELAY_MS },
            ...LIFECYCLE_JOB_RETENTION
          }
        }
      );

      logger.info('Reconciliation scheduler registered', {
        actor: 'worker',
        event: 'reconcile_scheduler_registered',
        entity: { type: 'queue', id: QUEUE_RECONCILE },
        outcome: 'success',
        attempt,
        maxAttempts,
        intervalMs
      });
      return;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const isLastAttempt = attempt === maxAttempts;

      if (isLastAttempt) {
        logger.error('Reconciliation scheduler registration failed', {
          actor: 'worker',
          event: 'reconcile_scheduler_registration_failed',
          entity: { type: 'queue', id: QUEUE_RECONCILE },
          outcome: 'failure',
          attempt,
          maxAttempts,
          intervalMs,
          reason: 'attempts_exhausted',
          error
        });
        throw err;
      }

      const retryInMs = retryDelayMs * attempt;

      logger.warn('Reconciliation scheduler registration failed; retrying', {
        actor: 'worker',
        event: 'reconcile_scheduler_registration_failed',
        entity: { type: 'queue', id: QUEUE_RECONCILE },
        outcome: 'failure',
        attempt,
        maxAttempts,
        intervalMs,
        reason: 'retry_scheduled',
        retryInMs,
        error
      });

      await sleep(retryInMs);
    }
  }
}

export const RECONCILE_SCHEDULER_DEFAULT_INTERVAL_MS = DEFAULT_INTERVAL_MS;
export const RECONCILE_SCHEDULER_DEFAULT_MAX_ATTEMPTS = DEFAULT_MAX_ATTEMPTS;
export const RECONCILE_SCHEDULER_DEFAULT_RETRY_DELAY_MS = DEFAULT_RETRY_DELAY_MS;
export const RECONCILE_SCHEDULER_ID = SCHEDULER_ID;
