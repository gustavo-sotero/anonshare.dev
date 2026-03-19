import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { logger } from './logger';
import { buildWorkerJobLogContext, buildWorkerLifecycleLog } from './runtime-events';

describe('worker runtime event logs', () => {
  const originalError = console.error;
  const originalLog = console.log;
  const originalNodeEnv = process.env.NODE_ENV;
  let entries: Array<Record<string, unknown>> = [];

  function capture(line: unknown): void {
    if (typeof line !== 'string') {
      return;
    }

    try {
      entries.push(JSON.parse(line) as Record<string, unknown>);
    } catch {}
  }

  beforeEach(() => {
    entries = [];
    process.env.NODE_ENV = 'production';
    console.log = (...args: unknown[]) => {
      capture(args[0]);
    };
    console.error = (...args: unknown[]) => {
      capture(args[0]);
    };
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;

    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
      return;
    }

    process.env.NODE_ENV = originalNodeEnv;
  });

  test('emits worker_ready with stable worker service metadata', () => {
    logger.info('Worker ready', buildWorkerLifecycleLog('worker_ready'));

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actor: 'worker',
      event: 'worker_ready',
      outcome: 'success',
      service: 'worker'
    });
  });

  test('emits job_completed with queue, jobName, lag, and duration telemetry', () => {
    logger.info(
      'Job completed',
      buildWorkerJobLogContext({
        event: 'job_completed',
        job: {
          attemptsMade: 2,
          delay: 250,
          finishedOn: 1_900,
          id: 'job-123',
          name: 'cleanup-file',
          processedOn: 1_500,
          timestamp: 1_000
        },
        queue: 'cleanup-file'
      })
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      attemptsMade: 2,
      durationMs: 400,
      event: 'job_completed',
      jobName: 'cleanup-file',
      lagMs: 250,
      outcome: 'success',
      queue: 'cleanup-file',
      service: 'worker'
    });
    expect(entries[0]?.entity).toEqual({ id: 'job-123', type: 'job' });
  });

  test('emits job_failed with failure outcome even when BullMQ does not provide a job', () => {
    logger.error(
      'Job failed',
      buildWorkerJobLogContext({ error: 'boom', event: 'job_failed', queue: 'reconcile' })
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      attemptsMade: 0,
      durationMs: null,
      error: 'boom',
      event: 'job_failed',
      lagMs: null,
      outcome: 'failure',
      queue: 'reconcile',
      service: 'worker'
    });
  });
});
