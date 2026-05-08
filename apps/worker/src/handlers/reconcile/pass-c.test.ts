import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { logger } from '@anonshare/infrastructure/logger';
import { makeHandleReconcile } from './index';
import {
  type DbStubs,
  makeJob,
  makeMockDeps,
  type QueueStubs,
  type StorageStubs
} from './test-helpers';

afterEach(() => {
  mock.restore();
  mock.clearAllMocks();
});

describe('reconcile handler — Pass B: stuck pending_upload', () => {
  test('promotes stuck pending_upload to active when object exists in storage', async () => {
    const stuckFile = {
      id: 'stuck-1',
      objectKey: 'objects/stuck-1',
      expiresAt: null,
      uploadedAt: new Date(Date.now() - 20 * 60 * 1000) // 20 minutes ago
    };
    const db: DbStubs = {
      selectSequence: [[], [], [stuckFile], [], []],
      updateSequence: [[{ id: 'stuck-1' }]]
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/stuck-1': true }
    };
    const deps = makeMockDeps(db, storage);

    await makeHandleReconcile(deps)(makeJob());

    // Update was called to promote to active
    expect(db.capturedDeletes).toHaveLength(0);
  });

  test('promotes stuck pending_upload directly to expired and enqueues cleanup when expiresAt already passed', async () => {
    const alreadyExpired = new Date(Date.now() - 60 * 1000);
    const stuckFile = {
      id: 'stuck-expired',
      objectKey: 'objects/stuck-expired',
      expiresAt: alreadyExpired,
      uploadedAt: new Date(Date.now() - 20 * 60 * 1000)
    };
    const db: DbStubs = {
      selectSequence: [[], [], [stuckFile], [], []],
      updateSequence: [[{ id: 'stuck-expired' }]]
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/stuck-expired': true }
    };
    const queues: QueueStubs = {};
    const deps = makeMockDeps(db, storage, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedCleanupAdds).toHaveLength(1);
    expect(queues.capturedCleanupAdds?.[0]?.data.fileId).toBe('stuck-expired');
    expect(queues.capturedCleanupAdds?.[0]?.opts.jobId).toBe('cleanup:stuck-expired');
    expect(queues.capturedExpireAdds).toHaveLength(0);
  });

  test('re-schedules expiration job when promoting stuck pending with future expiresAt', async () => {
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour ahead
    const stuckFile = {
      id: 'stuck-exp',
      objectKey: 'objects/stuck-exp',
      expiresAt: futureExpiry,
      uploadedAt: new Date(Date.now() - 20 * 60 * 1000)
    };
    const db: DbStubs = {
      selectSequence: [[], [], [stuckFile], [], []],
      updateSequence: [[{ id: 'stuck-exp' }]]
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/stuck-exp': true }
    };
    const queues: QueueStubs = {};
    const deps = makeMockDeps(db, storage, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedExpireAdds).toHaveLength(1);
    expect(queues.capturedExpireAdds?.[0]?.data.fileId).toBe('stuck-exp');
    expect(queues.capturedExpireAdds?.[0]?.opts.jobId).toBe('expire:stuck-exp');
  });

  test('re-schedules expiration job when existing expire job is terminal for promoted pending file', async () => {
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000);
    const stuckFile = {
      id: 'stuck-exp-terminal',
      objectKey: 'objects/stuck-exp-terminal',
      expiresAt: futureExpiry,
      uploadedAt: new Date(Date.now() - 20 * 60 * 1000)
    };
    const db: DbStubs = {
      selectSequence: [[], [], [stuckFile], [], []],
      updateSequence: [[{ id: 'stuck-exp-terminal' }]]
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/stuck-exp-terminal': true }
    };
    const queues: QueueStubs = {
      existingExpireJobStates: { 'expire:stuck-exp-terminal': 'failed' }
    };
    const deps = makeMockDeps(db, storage, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedRemovedExpireJobIds).toEqual(['expire:stuck-exp-terminal']);
    expect(queues.capturedExpireAdds).toHaveLength(1);
    expect(queues.capturedExpireAdds?.[0]?.opts.jobId).toBe('expire:stuck-exp-terminal');
  });

  test('does not re-schedule expiration when expiresAt is null', async () => {
    const stuckFile = {
      id: 'stuck-noexp',
      objectKey: 'objects/stuck-noexp',
      expiresAt: null,
      uploadedAt: new Date(Date.now() - 20 * 60 * 1000)
    };
    const db: DbStubs = {
      selectSequence: [[], [], [stuckFile], [], []],
      updateSequence: [[{ id: 'stuck-noexp' }]]
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/stuck-noexp': true }
    };
    const queues: QueueStubs = {};
    const deps = makeMockDeps(db, storage, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedExpireAdds).toHaveLength(0);
  });

  test('deletes orphaned pending_upload record when storage object is missing', async () => {
    const stuckFile = {
      id: 'stuck-orphan',
      objectKey: 'objects/stuck-orphan',
      expiresAt: null,
      uploadedAt: new Date(Date.now() - 20 * 60 * 1000)
    };
    const db: DbStubs = {
      selectSequence: [[], [], [stuckFile], [], []],
      updateSequence: []
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/stuck-orphan': false }
    };
    const deps = makeMockDeps(db, storage);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedDeletes).toHaveLength(1);
  });

  test('skips stuck pending file when storage.exists throws (retry on next run)', async () => {
    const stuckFile = {
      id: 'stuck-storageerr',
      objectKey: 'objects/stuck-storageerr',
      expiresAt: null,
      uploadedAt: new Date(Date.now() - 20 * 60 * 1000)
    };
    const db: DbStubs = {
      selectSequence: [[], [], [stuckFile], [], []],
      updateSequence: []
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/stuck-storageerr': new Error('network timeout') }
    };
    const deps = makeMockDeps(db, storage);
    const warnSpy = spyOn(logger, 'warn');

    // Should not throw — just skip and continue
    await expect(makeHandleReconcile(deps)(makeJob())).resolves.toBeUndefined();
    expect(db.capturedDeletes).toHaveLength(0);
    expect(db.capturedAnomalies).toContainEqual(
      expect.objectContaining({
        type: 'reconciliation_scan_incomplete',
        fileId: 'stuck-storageerr',
        details: expect.objectContaining({
          phase: 'stuck_pending',
          operation: 'exists',
          reason: 'retry_next_run'
        })
      })
    );

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const firstCall = warnSpy.mock.calls.at(0);
    expect(firstCall?.[0]).toBe('Reconcile: storage check failed; leaving item for next run');
    expect(firstCall?.[1]).toMatchObject({
      event: 'reconciliation.anomaly_detected',
      anomalyType: 'storage_check_failed',
      phase: 'stuck_pending',
      operation: 'exists',
      objectKey: 'objects/stuck-storageerr',
      reason: 'retry_next_run',
      outcome: 'failure',
      entity: { type: 'file', id: 'stuck-storageerr' },
      error: 'network timeout'
    });
  });

  test('skips stuck pending when concurrent update changes status (0 rows returned)', async () => {
    const stuckFile = {
      id: 'stuck-race',
      objectKey: 'objects/stuck-race',
      expiresAt: null,
      uploadedAt: new Date(Date.now() - 20 * 60 * 1000)
    };
    const db: DbStubs = {
      selectSequence: [[], [], [stuckFile], [], []],
      updateSequence: [[]] // 0 rows
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/stuck-race': true }
    };
    const queues: QueueStubs = {};
    const deps = makeMockDeps(db, storage, queues);

    await makeHandleReconcile(deps)(makeJob());

    // Race: promotion update touched 0 rows → no expire job scheduled
    expect(queues.capturedExpireAdds).toHaveLength(0);
  });
});
