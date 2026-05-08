import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { logger } from '@anonshare/infrastructure/logger';
import { makeHandleReconcile } from './index';
import {
  type CursorStubs,
  type DbStubs,
  makeJob,
  makeMockDeps,
  type StorageStubs
} from './test-helpers';

afterEach(() => {
  mock.restore();
  mock.clearAllMocks();
});

describe('reconcile handler — Pass C: missing storage objects', () => {
  test('persists a missing-object cursor when the scan fills its batch', async () => {
    const activeFiles = Array.from({ length: 50 }, (_, idx) => ({
      id: `active-batch-${idx}`,
      objectKey: `objects/active-batch-${idx}`,
      uploadedAt: new Date(Date.parse('2026-03-01T00:00:00.000Z') + idx * 1_000),
      cursorTimestamp: new Date(Date.parse('2026-03-01T00:00:00.000Z') + idx * 1_000)
    }));
    const db: DbStubs = {
      selectSequence: [[], [], [], activeFiles, []]
    };
    const cursor: CursorStubs = {
      initialMissingObjectCursor: '2026-02-28T23:59:00.000Z|active-batch-prev'
    };
    const deps = makeMockDeps(db, {}, {}, cursor);

    await makeHandleReconcile(deps)(makeJob());

    expect(cursor.capturedPersistedMissingObjectCursors).toEqual([
      '2026-03-01T00:00:49.000Z|active-batch-49'
    ]);
  });

  test('marks active file as missing when storage object is absent', async () => {
    const activeFile = {
      id: 'active-missing',
      objectKey: 'objects/gone'
    };
    const db: DbStubs = {
      selectSequence: [[], [], [], [activeFile], []],
      updateSequence: [[{ id: 'active-missing' }]],
      anomalyFindFirstReturn: null
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/gone': false }
    };
    const deps = makeMockDeps(db, storage);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toHaveLength(1);
    expect(db.capturedAnomalies?.[0]?.type).toBe('missing_object');
    expect(db.capturedAnomalies?.[0]?.fileId).toBe('active-missing');
  });

  test('does not mark file as missing when object exists in storage', async () => {
    const activeFile = {
      id: 'active-present',
      objectKey: 'objects/present'
    };
    const db: DbStubs = {
      selectSequence: [[], [], [], [activeFile], []],
      updateSequence: []
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/present': true }
    };
    const deps = makeMockDeps(db, storage);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toHaveLength(0);
  });

  test('does not insert duplicate missing_object anomaly when one already exists', async () => {
    const activeFile = {
      id: 'dup-missing',
      objectKey: 'objects/dup-missing'
    };
    const db: DbStubs = {
      selectSequence: [[], [], [], [activeFile], []],
      updateSequence: [[{ id: 'dup-missing' }]],
      anomalyFindFirstReturn: { id: 'existing-missing-anomaly' }
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/dup-missing': false }
    };
    const deps = makeMockDeps(db, storage);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toHaveLength(0);
  });

  test('skips file when storage.exists throws (retry on next reconcile run)', async () => {
    const activeFile = {
      id: 'missing-storageerr',
      objectKey: 'objects/missing-storageerr'
    };
    const db: DbStubs = {
      selectSequence: [[], [], [], [activeFile], []],
      updateSequence: []
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/missing-storageerr': new Error('connection refused') }
    };
    const deps = makeMockDeps(db, storage);
    const warnSpy = spyOn(logger, 'warn');

    await expect(makeHandleReconcile(deps)(makeJob())).resolves.toBeUndefined();
    expect(db.capturedAnomalies).toContainEqual(
      expect.objectContaining({
        type: 'reconciliation_scan_incomplete',
        fileId: 'missing-storageerr',
        details: expect.objectContaining({
          phase: 'missing_object',
          operation: 'exists',
          reason: 'retry_next_run'
        })
      })
    );

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const firstCall = warnSpy.mock.calls.at(0);
    expect(firstCall?.[1]).toMatchObject({
      anomalyType: 'storage_check_failed',
      phase: 'missing_object',
      operation: 'exists',
      objectKey: 'objects/missing-storageerr',
      entity: { type: 'file', id: 'missing-storageerr' },
      error: 'connection refused'
    });
  });

  test('skips missing-object transition when concurrent update changes status (0 rows)', async () => {
    const activeFile = {
      id: 'missing-race',
      objectKey: 'objects/missing-race'
    };
    const db: DbStubs = {
      selectSequence: [[], [], [], [activeFile], []],
      updateSequence: [[]] // 0 rows returned
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/missing-race': false }
    };
    const deps = makeMockDeps(db, storage);

    await makeHandleReconcile(deps)(makeJob());

    // No anomaly if the update applied 0 rows (file already in terminal state)
    expect(db.capturedAnomalies).toHaveLength(0);
  });
});
