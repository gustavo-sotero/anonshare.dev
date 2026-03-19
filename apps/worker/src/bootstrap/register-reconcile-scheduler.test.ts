import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import {
  LIFECYCLE_JOB_RETENTION,
  RECONCILE_JOB_ATTEMPTS,
  RECONCILE_JOB_BACKOFF_DELAY_MS
} from '@anonshare/contracts';
import { logger } from '@anonshare/infrastructure/logger';
import {
  RECONCILE_SCHEDULER_DEFAULT_INTERVAL_MS,
  RECONCILE_SCHEDULER_ID,
  registerReconcileScheduler
} from './register-reconcile-scheduler';

afterEach(() => {
  mock.restore();
});

type SchedulerQueueStub = {
  upsertImpl?: () => Promise<void>;
  failuresBeforeSuccess?: number;
  calls: Array<{
    schedulerId: string;
    schedule: { every: number };
    job: {
      name: string;
      data: Record<string, never>;
      opts: {
        attempts: number;
        backoff: { type: string; delay: number };
        removeOnComplete: number;
        removeOnFail: number;
      };
    };
  }>;
};

function makeQueueStub(stub: Omit<SchedulerQueueStub, 'calls'> = {}) {
  let attempts = 0;
  const calls: SchedulerQueueStub['calls'] = [];

  return {
    queue: {
      upsertJobScheduler: async (
        schedulerId: string,
        schedule: { every: number },
        job: {
          name: string;
          data: Record<string, never>;
          opts: {
            attempts: number;
            backoff: { type: string; delay: number };
            removeOnComplete: number;
            removeOnFail: number;
          };
        }
      ) => {
        calls.push({ schedulerId, schedule, job });
        attempts += 1;

        if (stub.upsertImpl) {
          await stub.upsertImpl();
          return;
        }

        if (attempts <= (stub.failuresBeforeSuccess ?? 0)) {
          throw new Error(`redis unavailable (${attempts})`);
        }
      }
    },
    calls
  };
}

describe('registerReconcileScheduler', () => {
  test('registers the recurring reconcile scheduler with the canonical config', async () => {
    const infoSpy = spyOn(logger, 'info');
    const { queue, calls } = makeQueueStub();

    await registerReconcileScheduler(queue as never);

    expect(calls).toEqual([
      {
        schedulerId: RECONCILE_SCHEDULER_ID,
        schedule: { every: RECONCILE_SCHEDULER_DEFAULT_INTERVAL_MS },
        job: {
          name: 'reconcile',
          data: {},
          opts: {
            attempts: RECONCILE_JOB_ATTEMPTS,
            backoff: { type: 'exponential', delay: RECONCILE_JOB_BACKOFF_DELAY_MS },
            removeOnComplete: LIFECYCLE_JOB_RETENTION.removeOnComplete,
            removeOnFail: LIFECYCLE_JOB_RETENTION.removeOnFail
          }
        }
      }
    ]);
    expect(infoSpy).toHaveBeenCalledWith(
      'Reconciliation scheduler registered',
      expect.objectContaining({
        event: 'reconcile_scheduler_registered',
        outcome: 'success',
        service: 'worker',
        attempt: 1,
        intervalMs: RECONCILE_SCHEDULER_DEFAULT_INTERVAL_MS
      })
    );
  });

  test('retries transient scheduler registration failures before succeeding', async () => {
    const warnSpy = spyOn(logger, 'warn');
    const infoSpy = spyOn(logger, 'info');
    const slept: number[] = [];
    const { queue, calls } = makeQueueStub({ failuresBeforeSuccess: 2 });

    await registerReconcileScheduler(queue as never, {
      maxAttempts: 4,
      retryDelayMs: 250,
      sleep: async (ms) => {
        slept.push(ms);
      }
    });

    expect(calls).toHaveLength(3);
    expect(slept).toEqual([250, 500]);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(infoSpy).toHaveBeenCalledWith(
      'Reconciliation scheduler registered',
      expect.objectContaining({
        event: 'reconcile_scheduler_registered',
        attempt: 3,
        maxAttempts: 4,
        outcome: 'success',
        service: 'worker'
      })
    );
  });

  test('throws after exhausting retries and logs the terminal failure', async () => {
    const warnSpy = spyOn(logger, 'warn');
    const errorSpy = spyOn(logger, 'error');
    const slept: number[] = [];
    const { queue, calls } = makeQueueStub({ failuresBeforeSuccess: 10 });

    await expect(
      registerReconcileScheduler(queue as never, {
        maxAttempts: 3,
        retryDelayMs: 100,
        sleep: async (ms) => {
          slept.push(ms);
        }
      })
    ).rejects.toThrow('redis unavailable (3)');

    expect(calls).toHaveLength(3);
    expect(slept).toEqual([100, 200]);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(
      'Reconciliation scheduler registration failed',
      expect.objectContaining({
        event: 'reconcile_scheduler_registration_failed',
        outcome: 'failure',
        service: 'worker',
        attempt: 3,
        maxAttempts: 3,
        reason: 'attempts_exhausted'
      })
    );
  });
});
