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

describe('reconcile handler — Pass F: orphaned storage objects', () => {
  test('records orphaned_object anomaly when storage object has no metadata record', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [], []],
      anomalyFindFirstReturn: null
    };
    const storage: StorageStubs = {
      listResult: {
        objects: [
          {
            key: 'objects/orphaned-1',
            size: 2048,
            lastModified: new Date('2026-03-12T10:00:00Z'),
            etag: 'etag-orphaned-1'
          }
        ]
      }
    };
    const deps = makeMockDeps(db, storage);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toHaveLength(1);
    expect(db.capturedAnomalies?.[0]?.type).toBe('orphaned_object');
    expect(db.capturedAnomalies?.[0]?.fileId).toBeNull();
  });

  test('does not insert duplicate orphaned_object anomaly when one already exists', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [], []],
      anomalyFindFirstReturn: { id: 'existing-orphaned-anomaly' }
    };
    const storage: StorageStubs = {
      listResult: {
        objects: [
          {
            key: 'objects/orphaned-existing',
            size: 512,
            lastModified: new Date('2026-03-12T10:00:00Z'),
            etag: 'etag-orphaned-existing'
          }
        ]
      }
    };
    const deps = makeMockDeps(db, storage);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toHaveLength(0);
  });

  test('paginates orphaned-object scans so later storage pages are still checked', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [], [], []],
      anomalyFindFirstReturn: null
    };
    const storage: StorageStubs = {
      listResults: [
        {
          objects: [
            {
              key: 'objects/orphaned-page-1',
              size: 128,
              lastModified: new Date('2026-03-12T10:00:00Z'),
              etag: 'etag-page-1'
            }
          ],
          isTruncated: true,
          nextStartAfter: 'objects/orphaned-page-1'
        },
        {
          objects: [
            {
              key: 'objects/orphaned-page-2',
              size: 256,
              lastModified: new Date('2026-03-12T10:05:00Z'),
              etag: 'etag-page-2'
            }
          ],
          isTruncated: false,
          nextStartAfter: null
        }
      ]
    };
    const deps = makeMockDeps(db, storage);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toHaveLength(2);
    expect(storage.capturedListOptions).toHaveLength(2);
    expect(storage.capturedListOptions?.[1]).toMatchObject({
      startAfter: 'objects/orphaned-page-1'
    });
  });

  test('resumes orphan scan from the persisted cursor and saves the next cursor for the following run', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [], []],
      anomalyFindFirstReturn: null
    };
    const storage: StorageStubs = {
      listResult: {
        objects: [
          {
            key: 'objects/orphaned-after-cursor',
            size: 64,
            lastModified: new Date('2026-03-12T10:10:00Z'),
            etag: 'etag-after-cursor'
          }
        ],
        isTruncated: true,
        nextStartAfter: 'objects/orphaned-after-cursor'
      }
    };
    const cursor: CursorStubs = { initialOrphanCursor: 'objects/known-prefix-tail' };
    const deps = makeMockDeps(db, storage, {}, cursor);

    await makeHandleReconcile(deps)(makeJob());

    expect(storage.capturedListOptions?.[0]).toMatchObject({
      startAfter: 'objects/known-prefix-tail'
    });
    expect(cursor.capturedPersistedOrphanCursors).toEqual(['objects/orphaned-after-cursor']);
  });

  test('clears the persisted orphan scan cursor when the scan reaches the end of the bucket', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [], []]
    };
    const storage: StorageStubs = {
      listResult: {
        objects: [],
        isTruncated: false,
        nextStartAfter: null
      }
    };
    const cursor: CursorStubs = { initialOrphanCursor: 'objects/previous-page-tail' };
    const deps = makeMockDeps(db, storage, {}, cursor);

    await makeHandleReconcile(deps)(makeJob());

    expect(cursor.capturedPersistedOrphanCursors).toEqual([null]);
  });

  test('continues when orphan scan cursor persistence fails after a successful scan', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [], []]
    };
    const storage: StorageStubs = {
      listResult: {
        objects: [],
        isTruncated: false,
        nextStartAfter: null
      }
    };
    const cursor: CursorStubs = { orphanPersistShouldThrow: true };
    const deps = makeMockDeps(db, storage, {}, cursor);
    const warnSpy = spyOn(logger, 'warn');

    await expect(makeHandleReconcile(deps)(makeJob())).resolves.toBeUndefined();

    expect(db.capturedAnomalies).toHaveLength(1);
    expect(db.capturedAnomalies?.[0]).toMatchObject({
      type: 'reconciliation_scan_incomplete',
      fileId: null
    });
    expect(warnSpy).toHaveBeenCalledWith(
      'Reconcile: failed to persist orphan scan cursor',
      expect.objectContaining({
        event: 'reconciliation.anomaly_detected',
        anomalyType: 'orphaned_object_scan_cursor_failed',
        reason: 'cursor_write_failed',
        entity: { type: 'queue', id: 'reconcile' }
      })
    );
  });

  test('logs a warning when the orphaned-object scan cannot list storage objects', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [], []]
    };
    const storage: StorageStubs = {
      listShouldThrow: true
    };
    const deps = makeMockDeps(db, storage);
    const warnSpy = spyOn(logger, 'warn');

    await expect(makeHandleReconcile(deps)(makeJob())).resolves.toBeUndefined();

    expect(db.capturedAnomalies).toContainEqual(
      expect.objectContaining({
        type: 'reconciliation_scan_incomplete',
        fileId: null,
        details: expect.objectContaining({
          phase: 'orphaned_object_scan',
          operation: 'list',
          reason: 'retry_next_run'
        })
      })
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const firstCall = warnSpy.mock.calls.at(0);
    expect(firstCall?.[1]).toMatchObject({
      event: 'reconciliation.anomaly_detected',
      anomalyType: 'storage_check_failed',
      phase: 'orphaned_object_scan',
      operation: 'list',
      entity: { type: 'queue', id: 'reconcile' },
      error: 'storage list failed'
    });
  });

  test('logs incomplete scan warning when storage page is truncated without nextStartAfter cursor', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [], []]
    };
    const storage: StorageStubs = {
      listResult: {
        objects: [
          {
            key: 'objects/orphaned-no-cursor',
            size: 32,
            lastModified: new Date('2026-03-12T10:00:00Z'),
            etag: 'etag-no-cursor'
          }
        ],
        isTruncated: true,
        nextStartAfter: null
      }
    };
    const deps = makeMockDeps(db, storage);
    const warnSpy = spyOn(logger, 'warn');

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toHaveLength(2);
    expect(db.capturedAnomalies?.at(-1)).toMatchObject({
      type: 'reconciliation_scan_incomplete',
      fileId: null
    });
    expect(warnSpy).toHaveBeenCalledWith(
      'Reconcile: orphan scan truncated without continuation cursor',
      expect.objectContaining({
        event: 'reconciliation.anomaly_detected',
        anomalyType: 'orphaned_object_scan_incomplete',
        reason: 'missing_next_start_after',
        entity: { type: 'queue', id: 'reconcile' }
      })
    );
  });
});
