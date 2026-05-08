import { describe, expect, test } from 'bun:test';
import { LIFECYCLE_JOB_RETENTION } from '@anonshare/contracts';
import { makeHandleReconcile } from './index';
import {
  type DbStubs,
  makeJob,
  makeMockDeps,
  OVER_ANOMALY_THRESHOLD_MS,
  type QueueStubs
} from './test-helpers';

describe('reconcile handler — Pass A: stale expirations', () => {
  test('scans stale expirations in a bounded batch', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], []],
      updateSequence: []
    };
    const deps = makeMockDeps(db, {});

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedSelectLimits).toContain(200);
  });

  test('transitions active file past expiresAt to expired and enqueues cleanup job', async () => {
    const now = new Date();
    const staleFile = {
      id: 'stale-1',
      objectKey: 'objects/stale-1',
      expiresAt: new Date(now.getTime() - 5_000)
    };
    const db: DbStubs = {
      selectSequence: [[staleFile], [], []], // PassA=stale file, PassB=none, PassC=none
      updateSequence: [[{ id: 'stale-1' }]]
    };
    const queues: QueueStubs = {};
    const deps = makeMockDeps(db, {}, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedCleanupAdds).toHaveLength(1);
    expect(queues.capturedCleanupAdds?.[0]?.data.fileId).toBe('stale-1');
    expect(queues.capturedCleanupAdds?.[0]?.data.objectKey).toBe('objects/stale-1');
    expect(queues.capturedCleanupAdds?.[0]?.opts.jobId).toBe('cleanup:stale-1');
    expect(queues.capturedCleanupAdds?.[0]?.opts.removeOnComplete).toBe(
      LIFECYCLE_JOB_RETENTION.removeOnComplete
    );
    expect(queues.capturedCleanupAdds?.[0]?.opts.removeOnFail).toBe(
      LIFECYCLE_JOB_RETENTION.removeOnFail
    );
  });

  test('skips cleanup enqueue when concurrent update already changed the status (0 rows)', async () => {
    const now = new Date();
    const staleFile = {
      id: 'stale-race',
      objectKey: 'objects/race',
      expiresAt: new Date(now.getTime() - 5_000)
    };
    const db: DbStubs = {
      selectSequence: [[staleFile], [], []],
      updateSequence: [[]] // 0 rows = already updated concurrently
    };
    const queues: QueueStubs = {};
    const deps = makeMockDeps(db, {}, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedCleanupAdds).toHaveLength(0);
  });

  test('continues reconcile when expire queue job lookup fails during repair pass', async () => {
    const now = new Date();
    const db: DbStubs = {
      selectSequence: [
        [],
        [
          { id: 'future-file', expiresAt: new Date(now.getTime() + 60_000), objectKey: 'objects/f' }
        ],
        []
      ],
      anomalyFindFirstReturn: null
    };
    const queues: QueueStubs = {
      existingExpireJobLookupErrors: {
        'expire:future-file': new Error('redis unavailable')
      }
    };
    const deps = makeMockDeps(db, {}, queues);

    await makeHandleReconcile(deps)(makeJob({ olderThan: now.toISOString() }));

    expect(queues.capturedExpireAdds).toHaveLength(0);
    expect(db.capturedAnomalies).toContainEqual(
      expect.objectContaining({
        type: 'reconciliation_scan_incomplete',
        fileId: 'future-file',
        details: expect.objectContaining({
          queue: 'expire-file',
          operation: 'getJob',
          reason: 'queue_read_failed'
        })
      })
    );
  });

  test('records anomaly only for significantly overdue files (> 2 hours)', async () => {
    const now = new Date();
    const overdueMs = OVER_ANOMALY_THRESHOLD_MS;
    const staleFile = {
      id: 'very-stale',
      objectKey: 'objects/stale-2',
      expiresAt: new Date(now.getTime() - overdueMs)
    };
    const db: DbStubs = {
      selectSequence: [[staleFile], [], []],
      updateSequence: [[{ id: 'very-stale' }]],
      anomalyFindFirstReturn: null // no existing anomaly
    };
    const deps = makeMockDeps(db, {});

    // Use a fixed olderThan so the overdue calculation is deterministic
    await makeHandleReconcile(deps)(makeJob({ olderThan: now.toISOString() }));

    expect(db.capturedAnomalies).toHaveLength(1);
    expect(db.capturedAnomalies?.[0]?.type).toBe('stale_expiration');
    expect(db.capturedAnomalies?.[0]?.fileId).toBe('very-stale');
  });

  test('does not record anomaly when file is only slightly overdue (< 2 hours)', async () => {
    const now = new Date();
    const slightlyOverdueMs = 30 * 60 * 1000; // 30 minutes
    const staleFile = {
      id: 'slightly-stale',
      objectKey: 'objects/slight',
      expiresAt: new Date(now.getTime() - slightlyOverdueMs)
    };
    const db: DbStubs = {
      selectSequence: [[staleFile], [], []],
      updateSequence: [[{ id: 'slightly-stale' }]]
    };
    const deps = makeMockDeps(db, {});

    await makeHandleReconcile(deps)(makeJob({ olderThan: now.toISOString() }));

    expect(db.capturedAnomalies).toHaveLength(0);
  });

  test('does not insert duplicate anomaly when one already exists for that file', async () => {
    const now = new Date();
    const staleFile = {
      id: 'dup-stale',
      objectKey: 'objects/dup',
      expiresAt: new Date(now.getTime() - OVER_ANOMALY_THRESHOLD_MS)
    };
    const db: DbStubs = {
      selectSequence: [[staleFile], [], []],
      updateSequence: [[{ id: 'dup-stale' }]],
      anomalyFindFirstReturn: { id: 'existing-anomaly' } // anomaly already exists
    };
    const deps = makeMockDeps(db, {});

    await makeHandleReconcile(deps)(makeJob({ olderThan: now.toISOString() }));

    // No new anomaly inserted because one already exists
    expect(db.capturedAnomalies).toHaveLength(0);
  });
});
