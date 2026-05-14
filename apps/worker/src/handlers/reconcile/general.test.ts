import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { logger } from '@anonshare/infrastructure/logger';
import { makeHandleReconcile } from './index';
import { type DbStubs, makeJob, makeMockDeps, type QueueStubs } from './test-helpers';

afterEach(() => {
  mock.restore();
  mock.clearAllMocks();
});

describe('reconcile handler — general behaviour', () => {
  test('resolves successfully when all reconcile passes find no work to do', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], []]
    };
    const deps = makeMockDeps(db, {});

    await expect(makeHandleReconcile(deps)(makeJob())).resolves.toBeUndefined();
  });

  test('uses supplied olderThan timestamp instead of current time', async () => {
    // Provide an olderThan well in the past so a file with expiresAt just
    // before that cutoff is NOT treated as overdue yet.
    const olderThan = new Date('2020-01-01T00:00:00Z');
    const fileExpiredBeforeCutoff = {
      id: 'historical',
      objectKey: 'objects/historical',
      expiresAt: new Date('2019-12-31T23:59:00Z') // 1 minute before cutoff
    };
    const db: DbStubs = {
      selectSequence: [[fileExpiredBeforeCutoff], [], []],
      updateSequence: [[{ id: 'historical' }]]
    };
    const queues: QueueStubs = {};
    const deps = makeMockDeps(db, {}, queues);

    await makeHandleReconcile(deps)(makeJob({ olderThan: olderThan.toISOString() }));

    // File was expired relative to the supplied olderThan → cleanup queued
    expect(queues.capturedCleanupAdds).toHaveLength(1);
  });

  test('falls back to now when olderThan payload is invalid', async () => {
    const staleFile = {
      id: 'invalid-older-than',
      objectKey: 'objects/invalid-older-than',
      expiresAt: new Date(Date.now() - 5_000)
    };
    const db: DbStubs = {
      selectSequence: [[staleFile], [], []],
      updateSequence: [[{ id: 'invalid-older-than' }]]
    };
    const queues: QueueStubs = {};
    const deps = makeMockDeps(db, {}, queues);
    const warnSpy = spyOn(logger, 'warn');

    await makeHandleReconcile(deps)(makeJob({ olderThan: 'not-a-date' }));

    expect(queues.capturedCleanupAdds).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledWith(
      'Reconcile: invalid olderThan payload, defaulting to now',
      expect.objectContaining({
        event: 'reconciliation.anomaly_detected',
        anomalyType: 'invalid_reconcile_payload',
        reason: 'invalid_older_than',
        olderThan: 'not-a-date',
        entity: { type: 'queue', id: 'reconcile' }
      })
    );
  });

  test('records backlog anomaly when existing lifecycle job state cannot be inspected', async () => {
    const futureFile = {
      id: 'future-unreadable-job',
      objectKey: 'objects/future-unreadable-job',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    };
    const db: DbStubs = {
      selectSequence: [[], [futureFile], [], [], []]
    };
    const queues: QueueStubs = {
      existingExpireJobStates: { 'expire-future-unreadable-job': 'waiting' },
      existingExpireJobStateErrors: {
        'expire-future-unreadable-job': new Error('state lookup failed')
      }
    };
    const deps = makeMockDeps(db, {}, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toHaveLength(1);
    expect(db.capturedAnomalies?.[0]).toMatchObject({
      type: 'reconciliation_scan_incomplete',
      fileId: 'future-unreadable-job'
    });
  });

  test('includes reconciliation duration telemetry in completion log', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], []]
    };
    const deps = makeMockDeps(db, {});
    const infoSpy = spyOn(logger, 'info');

    await makeHandleReconcile(deps)(makeJob());

    const completionCall = infoSpy.mock.calls.find(
      (call) => call[0] === 'Reconciliation completed'
    );

    expect(completionCall).toBeDefined();
    expect(completionCall?.[1]).toMatchObject({
      event: 'reconciliation.completed',
      outcome: 'success'
    });

    const loggedDuration = (completionCall?.[1] as { durationMs?: unknown })?.durationMs;
    expect(typeof loggedDuration).toBe('number');
    expect((loggedDuration as number) >= 0).toBe(true);
  });

  test('handles multiple stale files in Pass A independently', async () => {
    const now = new Date();
    const stale1 = {
      id: 'multi-1',
      objectKey: 'objects/multi-1',
      expiresAt: new Date(now.getTime() - 5_000)
    };
    const stale2 = {
      id: 'multi-2',
      objectKey: 'objects/multi-2',
      expiresAt: new Date(now.getTime() - 10_000)
    };
    const db: DbStubs = {
      selectSequence: [[stale1, stale2], [], []],
      updateSequence: [[{ id: 'multi-1' }], [{ id: 'multi-2' }]]
    };
    const queues: QueueStubs = {};
    const deps = makeMockDeps(db, {}, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedCleanupAdds).toHaveLength(2);
    const jobIds = queues.capturedCleanupAdds?.map((a) => a.opts.jobId);
    expect(jobIds).toContain('cleanup-multi-1');
    expect(jobIds).toContain('cleanup-multi-2');
  });

  test('detects duplicate pending lifecycle jobs for the same file', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], []]
    };
    const queues: QueueStubs = {
      expirePendingJobs: [
        { id: 'expire-1', data: { fileId: 'file-dup' } },
        { id: 'expire-2', data: { fileId: 'file-dup' } }
      ],
      cleanupPendingJobs: [{ id: 'cleanup-1', data: { fileId: 'file-other' } }]
    };
    const deps = makeMockDeps(db, {}, queues);
    const warnSpy = spyOn(logger, 'warn');

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toHaveLength(1);
    expect(db.capturedAnomalies?.[0]).toMatchObject({
      type: 'lifecycle_job_duplicate',
      fileId: 'file-dup'
    });
    expect(warnSpy).toHaveBeenCalledWith(
      'Reconcile: duplicate lifecycle jobs detected for same file',
      expect.objectContaining({
        event: 'reconciliation.anomaly_detected',
        anomalyType: 'lifecycle_job_duplicate',
        queue: 'expire-file',
        fileId: 'file-dup',
        duplicateCount: 2,
        jobIds: ['expire-1', 'expire-2']
      })
    );
  });

  test('continues reconciliation when lifecycle queue duplicate scan fails', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], []]
    };
    const queues: QueueStubs = {
      cleanupGetJobsShouldThrow: true
    };
    const deps = makeMockDeps(db, {}, queues);
    const warnSpy = spyOn(logger, 'warn');

    await expect(makeHandleReconcile(deps)(makeJob())).resolves.toBeUndefined();

    expect(db.capturedAnomalies).toHaveLength(1);
    expect(db.capturedAnomalies?.[0]).toMatchObject({
      type: 'reconciliation_scan_incomplete',
      fileId: null
    });
    expect(warnSpy).toHaveBeenCalledWith(
      'Reconcile: failed to inspect lifecycle queue state',
      expect.objectContaining({
        event: 'reconciliation.anomaly_detected',
        anomalyType: 'lifecycle_queue_read_failed',
        queue: 'cleanup-file',
        operation: 'getJobs',
        reason: 'queue_read_failed',
        entity: { type: 'queue', id: 'cleanup-file' }
      })
    );
  });
});
