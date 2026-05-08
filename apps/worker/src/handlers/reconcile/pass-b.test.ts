import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { LIFECYCLE_JOB_RETENTION } from '@anonshare/contracts';
import { logger } from '@anonshare/infrastructure/logger';
import { makeHandleReconcile } from './index';
import {
  type CursorStubs,
  type DbStubs,
  makeJob,
  makeMockDeps,
  type QueueStubs
} from './test-helpers';

afterEach(() => {
  mock.restore();
  mock.clearAllMocks();
});

describe('reconcile handler — Pass B: future expiration job repair', () => {
  test('records an anomaly and clears an invalid future-expiration cursor', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], [], [], []],
      anomalyFindFirstReturn: null
    };
    const cursor: CursorStubs = {
      initialFutureExpirationCursor: 'not-a-valid-cursor'
    };
    const deps = makeMockDeps(db, {}, {}, cursor);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toContainEqual(
      expect.objectContaining({
        type: 'reconciliation_scan_incomplete',
        fileId: null,
        details: expect.objectContaining({
          queue: 'reconcile',
          cursor: 'future_expiration',
          reason: 'cursor_invalid',
          rawCursor: 'not-a-valid-cursor'
        })
      })
    );
    expect(cursor.capturedPersistedFutureExpirationCursors).toContain(null);
  });

  test('records an anomaly when the future-expiration cursor cannot be loaded', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], [], [], []],
      anomalyFindFirstReturn: null
    };
    const cursor: CursorStubs = {
      futureLoadShouldThrow: true
    };
    const deps = makeMockDeps(db, {}, {}, cursor);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toContainEqual(
      expect.objectContaining({
        type: 'reconciliation_scan_incomplete',
        fileId: null,
        details: expect.objectContaining({
          queue: 'reconcile',
          cursor: 'future_expiration',
          reason: 'cursor_read_failed'
        })
      })
    );
  });

  test('re-enqueues expire-file when a future-expiring file has no delayed job', async () => {
    const futureFile = {
      id: 'future-expire',
      objectKey: 'objects/future-expire',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    };
    const db: DbStubs = {
      selectSequence: [[], [futureFile], [], [], []]
    };
    const queues: QueueStubs = {};
    const deps = makeMockDeps(db, {}, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedExpireAdds).toHaveLength(1);
    expect(queues.capturedExpireAdds?.[0]?.data.fileId).toBe('future-expire');
    expect(queues.capturedExpireAdds?.[0]?.opts.jobId).toBe('expire:future-expire');
    expect(queues.capturedExpireAdds?.[0]?.opts.removeOnComplete).toBe(
      LIFECYCLE_JOB_RETENTION.removeOnComplete
    );
    expect(queues.capturedExpireAdds?.[0]?.opts.removeOnFail).toBe(
      LIFECYCLE_JOB_RETENTION.removeOnFail
    );
  });

  test('persists a future-expiration cursor when the repair scan fills its batch', async () => {
    const futureFiles = Array.from({ length: 100 }, (_, idx) => ({
      id: `future-batch-${idx}`,
      objectKey: `objects/future-batch-${idx}`,
      expiresAt: new Date(Date.parse('2030-01-01T00:00:00.000Z') + idx * 1_000),
      cursorTimestamp: new Date(Date.parse('2030-01-01T00:00:00.000Z') + idx * 1_000)
    }));
    const db: DbStubs = {
      selectSequence: [[], futureFiles, [], [], []]
    };
    const cursor: CursorStubs = {
      initialFutureExpirationCursor: '2029-12-31T23:59:00.000Z|future-batch-prev'
    };
    const deps = makeMockDeps(db, {}, {}, cursor);

    await makeHandleReconcile(deps)(makeJob());

    expect(cursor.capturedPersistedFutureExpirationCursors).toEqual([
      '2030-01-01T00:01:39.000Z|future-batch-99'
    ]);
  });

  test('records an anomaly when future-expiration cursor persistence fails', async () => {
    const futureFiles = Array.from({ length: 100 }, (_, idx) => ({
      id: `future-persist-${idx}`,
      objectKey: `objects/future-persist-${idx}`,
      expiresAt: new Date(Date.parse('2031-01-01T00:00:00.000Z') + idx * 1_000),
      cursorTimestamp: new Date(Date.parse('2031-01-01T00:00:00.000Z') + idx * 1_000)
    }));
    const db: DbStubs = {
      selectSequence: [[], futureFiles, [], [], []],
      anomalyFindFirstReturn: null
    };
    const cursor: CursorStubs = {
      futurePersistShouldThrow: true
    };
    const deps = makeMockDeps(db, {}, {}, cursor);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toContainEqual(
      expect.objectContaining({
        type: 'reconciliation_scan_incomplete',
        fileId: null,
        details: expect.objectContaining({
          queue: 'reconcile',
          cursor: 'future_expiration',
          reason: 'cursor_write_failed'
        })
      })
    );
    expect(cursor.capturedPersistedFutureExpirationCursors).toEqual([
      '2031-01-01T00:01:39.000Z|future-persist-99'
    ]);
  });

  test('re-enqueues expire-file when existing job is terminal (completed)', async () => {
    const futureFile = {
      id: 'future-terminal',
      objectKey: 'objects/future-terminal',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    };
    const db: DbStubs = {
      selectSequence: [[], [futureFile], [], [], []]
    };
    const queues: QueueStubs = {
      existingExpireJobStates: { 'expire:future-terminal': 'completed' }
    };
    const deps = makeMockDeps(db, {}, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedRemovedExpireJobIds).toEqual(['expire:future-terminal']);
    expect(queues.capturedExpireAdds).toHaveLength(1);
    expect(queues.capturedExpireAdds?.[0]?.opts.jobId).toBe('expire:future-terminal');
  });

  test('re-enqueues expire-file when existing job is terminal (failed)', async () => {
    const futureFile = {
      id: 'future-terminal-failed',
      objectKey: 'objects/future-terminal-failed',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    };
    const db: DbStubs = {
      selectSequence: [[], [futureFile], [], [], []]
    };
    const queues: QueueStubs = {
      existingExpireJobStates: { 'expire:future-terminal-failed': 'failed' }
    };
    const deps = makeMockDeps(db, {}, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedRemovedExpireJobIds).toEqual(['expire:future-terminal-failed']);
    expect(queues.capturedExpireAdds).toHaveLength(1);
    expect(queues.capturedExpireAdds?.[0]?.opts.jobId).toBe('expire:future-terminal-failed');
  });

  test('does not re-enqueue expire-file when the delayed job already exists', async () => {
    const futureFile = {
      id: 'future-existing',
      objectKey: 'objects/future-existing',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    };
    const db: DbStubs = {
      selectSequence: [[], [futureFile], [], [], []]
    };
    const queues: QueueStubs = {
      existingExpireJobStates: { 'expire:future-existing': 'waiting' }
    };
    const deps = makeMockDeps(db, {}, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedExpireAdds).toHaveLength(0);
  });

  test('logs overdue anomaly when existing expire job is still pending long after scheduled time', async () => {
    const futureFile = {
      id: 'future-overdue-job',
      objectKey: 'objects/future-overdue-job',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    };
    const db: DbStubs = {
      selectSequence: [[], [futureFile], [], [], []]
    };
    const queuedAt = Date.now() - 20 * 60 * 1000;
    const queues: QueueStubs = {
      existingExpireJobStates: { 'expire:future-overdue-job': 'delayed' },
      existingExpireJobTimestamps: { 'expire:future-overdue-job': queuedAt },
      existingExpireJobDelays: { 'expire:future-overdue-job': 0 }
    };
    const deps = makeMockDeps(db, {}, queues);
    const warnSpy = spyOn(logger, 'warn');

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedExpireAdds).toHaveLength(0);
    expect(db.capturedAnomalies).toHaveLength(1);
    expect(db.capturedAnomalies?.[0]).toMatchObject({
      type: 'lifecycle_job_overdue',
      fileId: 'future-overdue-job'
    });
    expect(warnSpy).toHaveBeenCalledWith(
      'Reconcile: existing lifecycle job is pending but overdue',
      expect.objectContaining({
        event: 'reconciliation.anomaly_detected',
        anomalyType: 'lifecycle_job_overdue',
        queue: 'expire-file',
        state: 'delayed',
        reason: 'pending_job_overdue',
        entity: { type: 'file', id: 'future-overdue-job' }
      })
    );
  });
});
