import { afterEach, describe, expect, mock, test } from 'bun:test';
import { makeHandleReconcile } from './index';
import { type DbStubs, makeJob, makeMockDeps, type QueueStubs } from './test-helpers';

afterEach(() => {
  mock.restore();
  mock.clearAllMocks();
});

describe('reconcile handler — Pass G: duplicate lifecycle jobs', () => {
  test('records anomaly when two cleanup jobs exist for the same file', async () => {
    const queues: QueueStubs = {
      cleanupPendingJobs: [
        { id: 'cleanup:file-1:1', data: { fileId: 'file-1' } },
        { id: 'cleanup:file-1:2', data: { fileId: 'file-1' } }
      ]
    };
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [], [], []],
      anomalyFindFirstReturn: null
    };
    const deps = makeMockDeps(db, {}, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toHaveLength(1);
    expect(db.capturedAnomalies?.[0]?.type).toBe('lifecycle_job_duplicate');
    const details = db.capturedAnomalies?.[0]?.details as Record<string, unknown>;
    expect(details?.queue).toBe('cleanup-file');
    expect(details?.duplicateCount).toBe(2);
  });

  test('records anomaly when two expire jobs exist for the same file', async () => {
    const queues: QueueStubs = {
      expirePendingJobs: [
        { id: 'expire:file-2:1', data: { fileId: 'file-2' } },
        { id: 'expire:file-2:2', data: { fileId: 'file-2' } }
      ]
    };
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [], [], []],
      anomalyFindFirstReturn: null
    };
    const deps = makeMockDeps(db, {}, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toHaveLength(1);
    expect(db.capturedAnomalies?.[0]?.type).toBe('lifecycle_job_duplicate');
    const details = db.capturedAnomalies?.[0]?.details as Record<string, unknown>;
    expect(details?.queue).toBe('expire-file');
    expect(details?.duplicateCount).toBe(2);
  });

  test('does not insert duplicate anomaly when one already exists for the job group', async () => {
    const queues: QueueStubs = {
      cleanupPendingJobs: [
        { id: 'cleanup:file-3:1', data: { fileId: 'file-3' } },
        { id: 'cleanup:file-3:2', data: { fileId: 'file-3' } }
      ]
    };
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [], [], []],
      anomalyFindFirstReturn: { id: 'existing-duplicate-anomaly' }
    };
    const deps = makeMockDeps(db, {}, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toHaveLength(0);
  });

  test('records queue scan failure when getJobs throws for cleanup queue', async () => {
    const queues: QueueStubs = { cleanupGetJobsShouldThrow: true };
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [], [], []],
      anomalyFindFirstReturn: null
    };
    const deps = makeMockDeps(db, {}, queues);

    await makeHandleReconcile(deps)(makeJob());

    // queue read failure is recorded as reconciliation_scan_incomplete
    expect(db.capturedAnomalies).toHaveLength(1);
    expect(db.capturedAnomalies?.[0]?.type).toBe('reconciliation_scan_incomplete');
  });

  test('records queue scan failure when getJobs throws for expire queue', async () => {
    const queues: QueueStubs = { expireGetJobsShouldThrow: true };
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [], [], []],
      anomalyFindFirstReturn: null
    };
    const deps = makeMockDeps(db, {}, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toHaveLength(1);
    expect(db.capturedAnomalies?.[0]?.type).toBe('reconciliation_scan_incomplete');
  });

  test('does not record anomaly when all jobs are for distinct files', async () => {
    const queues: QueueStubs = {
      cleanupPendingJobs: [
        { id: 'cleanup:file-a', data: { fileId: 'file-a' } },
        { id: 'cleanup:file-b', data: { fileId: 'file-b' } },
        { id: 'cleanup:file-c', data: { fileId: 'file-c' } }
      ]
    };
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [], [], []],
      anomalyFindFirstReturn: null
    };
    const deps = makeMockDeps(db, {}, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toHaveLength(0);
  });

  test('records one anomaly per duplicate group when multiple files have duplicates', async () => {
    const queues: QueueStubs = {
      cleanupPendingJobs: [
        { id: 'cleanup:file-x:1', data: { fileId: 'file-x' } },
        { id: 'cleanup:file-x:2', data: { fileId: 'file-x' } },
        { id: 'cleanup:file-y:1', data: { fileId: 'file-y' } },
        { id: 'cleanup:file-y:2', data: { fileId: 'file-y' } },
        { id: 'cleanup:file-y:3', data: { fileId: 'file-y' } }
      ]
    };
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [], [], []],
      anomalyFindFirstReturn: null
    };
    const deps = makeMockDeps(db, {}, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toHaveLength(2);
    expect(db.capturedAnomalies?.every((a) => a.type === 'lifecycle_job_duplicate')).toBe(true);
  });
});
