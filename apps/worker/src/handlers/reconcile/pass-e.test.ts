import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { ONE_TIME_DOWNLOAD_CLEANUP_DELAY_MS } from '@anonshare/contracts';
import { logger } from '@anonshare/infrastructure/logger';
import { makeHandleReconcile } from './index';
import {
  type CursorStubs,
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

describe('reconcile handler — Pass E: terminal cleanup repair', () => {
  test('persists a terminal-cleanup cursor when the scan fills its batch', async () => {
    const terminalFiles = Array.from({ length: 100 }, (_, idx) => ({
      id: `terminal-batch-${idx}`,
      objectKey: `objects/terminal-batch-${idx}`,
      status: 'expired',
      consumedAt: null,
      uploadedAt: new Date(Date.parse('2026-03-02T00:00:00.000Z') + idx * 1_000),
      cursorTimestamp: new Date(Date.parse('2026-03-02T00:00:00.000Z') + idx * 1_000)
    }));
    const db: DbStubs = {
      selectSequence: [[], [], [], [], terminalFiles]
    };
    const storage: StorageStubs = {
      existsResults: Object.fromEntries(
        terminalFiles.map((file) => [file.objectKey, false] as const)
      )
    };
    const cursor: CursorStubs = {
      initialTerminalCleanupCursor: '2026-03-01T23:59:00.000Z|terminal-batch-prev'
    };
    const deps = makeMockDeps(db, storage, {}, cursor);

    await makeHandleReconcile(deps)(makeJob());

    expect(cursor.capturedPersistedTerminalCleanupCursors).toEqual([
      '2026-03-02T00:01:39.000Z|terminal-batch-99'
    ]);
  });

  test('enqueues cleanup for consumed file whose object still exists', async () => {
    const terminalFile = {
      id: 'consumed-terminal',
      objectKey: 'objects/consumed-terminal'
    };
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [terminalFile]]
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/consumed-terminal': true }
    };
    const queues: QueueStubs = {};
    const deps = makeMockDeps(db, storage, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedCleanupAdds).toHaveLength(1);
    expect(queues.capturedCleanupAdds?.[0]?.data.fileId).toBe('consumed-terminal');
    expect(queues.capturedCleanupAdds?.[0]?.opts.jobId).toBe('cleanup:consumed-terminal');
  });

  test('re-enqueues cleanup when existing cleanup job is terminal (failed)', async () => {
    const terminalFile = {
      id: 'terminal-failed-cleanup',
      objectKey: 'objects/terminal-failed-cleanup'
    };
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [terminalFile]]
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/terminal-failed-cleanup': true }
    };
    const queues: QueueStubs = {
      existingCleanupJobStates: { 'cleanup:terminal-failed-cleanup': 'failed' }
    };
    const deps = makeMockDeps(db, storage, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedRemovedCleanupJobIds).toEqual(['cleanup:terminal-failed-cleanup']);
    expect(queues.capturedCleanupAdds).toHaveLength(1);
    expect(queues.capturedCleanupAdds?.[0]?.opts.jobId).toBe('cleanup:terminal-failed-cleanup');
  });

  test('does not enqueue cleanup when a cleanup job already exists for the terminal file', async () => {
    const terminalFile = {
      id: 'terminal-existing-cleanup',
      objectKey: 'objects/terminal-existing-cleanup'
    };
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [terminalFile]]
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/terminal-existing-cleanup': true }
    };
    const queues: QueueStubs = {
      existingCleanupJobStates: { 'cleanup:terminal-existing-cleanup': 'delayed' }
    };
    const deps = makeMockDeps(db, storage, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedCleanupAdds).toHaveLength(0);
  });

  test('does not enqueue cleanup for recently consumed one-time file until the delivery window expires', async () => {
    const terminalFile = {
      id: 'consumed-recently',
      objectKey: 'objects/consumed-recently',
      status: 'consumed',
      consumedAt: new Date(Date.now() - (ONE_TIME_DOWNLOAD_CLEANUP_DELAY_MS - 5_000))
    };
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [terminalFile]]
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/consumed-recently': true }
    };
    const queues: QueueStubs = {};
    const deps = makeMockDeps(db, storage, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedCleanupAdds).toHaveLength(0);
  });

  test('skips cleanup repair when storage.exists throws and logs the failure', async () => {
    const terminalFile = {
      id: 'terminal-storageerr',
      objectKey: 'objects/terminal-storageerr'
    };
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [terminalFile]]
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/terminal-storageerr': new Error('temporary rediscovery failure') }
    };
    const queues: QueueStubs = {};
    const deps = makeMockDeps(db, storage, queues);
    const warnSpy = spyOn(logger, 'warn');

    await expect(makeHandleReconcile(deps)(makeJob())).resolves.toBeUndefined();

    expect(queues.capturedCleanupAdds).toHaveLength(0);
    expect(db.capturedAnomalies).toContainEqual(
      expect.objectContaining({
        type: 'reconciliation_scan_incomplete',
        fileId: 'terminal-storageerr',
        details: expect.objectContaining({
          phase: 'terminal_cleanup',
          operation: 'exists',
          reason: 'retry_next_run'
        })
      })
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const firstCall = warnSpy.mock.calls.at(0);
    expect(firstCall?.[1]).toMatchObject({
      anomalyType: 'storage_check_failed',
      phase: 'terminal_cleanup',
      operation: 'exists',
      objectKey: 'objects/terminal-storageerr',
      entity: { type: 'file', id: 'terminal-storageerr' },
      error: 'temporary rediscovery failure'
    });
  });
});
