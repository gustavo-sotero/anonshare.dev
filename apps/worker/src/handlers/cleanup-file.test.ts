import { describe, expect, test } from 'bun:test';
import type { CleanupFileJobPayload } from '@anonshare/contracts';
import type { createDb } from '@anonshare/infrastructure/db';
import { StorageError } from '@anonshare/infrastructure/storage';
import type { Job } from 'bullmq';
import { type CleanupFileHandlerDeps, makeHandleCleanupFile } from './cleanup-file';

// ── Test-double helpers ───────────────────────────────────────────────────────

type FileRow = {
  id: string;
  status: string;
};

type DbStubs = {
  findFirst?: FileRow | null;
  anomalyFindFirstReturn?: unknown;
  capturedAnomalies?: Array<{ type: string; fileId: string; details: unknown }>;
  insertShouldThrow?: boolean;
};

type StorageStubs = {
  deleteShouldThrow?: Error | null;
  capturedDeletes?: string[];
};

function makeMockDeps(db: DbStubs = {}, storage: StorageStubs = {}): CleanupFileHandlerDeps {
  const capturedAnomalies: Array<{ type: string; fileId: string; details: unknown }> = [];
  const capturedDeletes: string[] = [];
  db.capturedAnomalies = capturedAnomalies;
  storage.capturedDeletes = capturedDeletes;

  return {
    db: {
      query: {
        files: {
          findFirst: async (_opts: unknown) => {
            return db.findFirst !== undefined
              ? db.findFirst
              : { id: 'file-uuid-1', status: 'expired' };
          }
        },
        operationalAnomalies: {
          findFirst: async (_opts: unknown) => db.anomalyFindFirstReturn ?? null
        }
      },
      insert: (_tbl: unknown) => ({
        values: async (vals: { type: string; fileId: string; details: unknown }) => {
          if (db.insertShouldThrow) throw new Error('DB insert failed');
          capturedAnomalies.push(vals);
        }
      })
    } as unknown as ReturnType<typeof createDb>,

    storage: {
      delete: async (key: string) => {
        capturedDeletes.push(key);
        if (storage.deleteShouldThrow) throw storage.deleteShouldThrow;
      }
    }
  };
}

function makeJob(
  overrides: Partial<{ fileId: string; objectKey: string }> = {},
  jobMeta: { attemptsMade?: number; attempts?: number } = {}
): Job<CleanupFileJobPayload> {
  return {
    data: {
      fileId: overrides.fileId ?? 'file-uuid-1',
      objectKey: overrides.objectKey ?? 'objects/test-key'
    },
    attemptsMade: jobMeta.attemptsMade ?? 0,
    opts: { attempts: jobMeta.attempts ?? 3 }
  } as unknown as Job<CleanupFileJobPayload>;
}

function makeStorageError(kind: StorageError['kind'], message = 'storage error'): StorageError {
  // StorageError constructor: (message, kind, cause?)
  return new StorageError(message, kind);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('cleanup-file handler', () => {
  describe('idempotent guard: file restored to active state', () => {
    test('skips deletion when file is in active state (admin restored it)', async () => {
      const storage: StorageStubs = {};
      const deps = makeMockDeps({ findFirst: { id: 'f1', status: 'active' } }, storage);
      const handler = makeHandleCleanupFile(deps);

      await handler(makeJob());

      expect(storage.capturedDeletes).toHaveLength(0);
    });

    test('skips deletion when file is in expiring state (admin restored it)', async () => {
      const storage: StorageStubs = {};
      const deps = makeMockDeps({ findFirst: { id: 'f1', status: 'expiring' } }, storage);
      const handler = makeHandleCleanupFile(deps);

      await handler(makeJob());

      expect(storage.capturedDeletes).toHaveLength(0);
    });
  });

  describe('successful cleanup', () => {
    test('deletes the storage object when file is in expired state', async () => {
      const storage: StorageStubs = {};
      const deps = makeMockDeps({ findFirst: { id: 'f1', status: 'expired' } }, storage);
      const handler = makeHandleCleanupFile(deps);

      await handler(makeJob({ objectKey: 'objects/my-key' }));

      expect(storage.capturedDeletes).toEqual(['objects/my-key']);
    });

    test('deletes the storage object when file record is absent (already cleaned up)', async () => {
      const storage: StorageStubs = {};
      const deps = makeMockDeps({ findFirst: null }, storage);
      const handler = makeHandleCleanupFile(deps);

      await handler(makeJob({ objectKey: 'objects/absent-key' }));

      expect(storage.capturedDeletes).toEqual(['objects/absent-key']);
    });

    test('resolves without error when object is not found in storage (idempotent)', async () => {
      const storage: StorageStubs = {
        deleteShouldThrow: makeStorageError('not_found', 'object does not exist')
      };
      const deps = makeMockDeps({ findFirst: { id: 'f1', status: 'expired' } }, storage);
      const handler = makeHandleCleanupFile(deps);

      await expect(handler(makeJob())).resolves.toBeUndefined();
    });

    test('does not record an anomaly when object is not found (idempotent success)', async () => {
      const db: DbStubs = {};
      const storage: StorageStubs = {
        deleteShouldThrow: makeStorageError('not_found')
      };
      const deps = makeMockDeps(db, storage);
      const handler = makeHandleCleanupFile(deps);

      await handler(makeJob());

      expect(db.capturedAnomalies).toHaveLength(0);
    });
  });

  describe('permanent storage failure', () => {
    test('resolves (does not rethrow) on permanent storage error', async () => {
      const storage: StorageStubs = {
        deleteShouldThrow: makeStorageError('permanent', 'permission denied')
      };
      const deps = makeMockDeps({ findFirst: { id: 'f1', status: 'expired' } }, storage);
      const handler = makeHandleCleanupFile(deps);

      await expect(handler(makeJob())).resolves.toBeUndefined();
    });

    test('records a failed_cleanup anomaly on permanent storage error', async () => {
      const db: DbStubs = {};
      const storage: StorageStubs = {
        deleteShouldThrow: makeStorageError('permanent', 'permission denied')
      };
      const deps = makeMockDeps(db, storage);
      const handler = makeHandleCleanupFile(deps);

      await handler(makeJob({ fileId: 'perm-id', objectKey: 'objects/perm' }));

      expect(db.capturedAnomalies).toHaveLength(1);
      expect(db.capturedAnomalies?.at(0)?.type).toBe('failed_cleanup');
      expect(db.capturedAnomalies?.at(0)?.fileId).toBe('perm-id');
    });

    test('does not create a duplicate open failed_cleanup anomaly for the same file', async () => {
      const db: DbStubs = {
        anomalyFindFirstReturn: { id: 'existing-anomaly' }
      };
      const storage: StorageStubs = {
        deleteShouldThrow: makeStorageError('permanent', 'permission denied')
      };
      const deps = makeMockDeps(db, storage);
      const handler = makeHandleCleanupFile(deps);

      await handler(makeJob({ fileId: 'perm-id', objectKey: 'objects/perm' }));

      expect(db.capturedAnomalies).toHaveLength(0);
    });
  });

  describe('transient storage failure', () => {
    test('rethrows transient error so BullMQ can retry', async () => {
      const storage: StorageStubs = {
        deleteShouldThrow: makeStorageError('transient', 'network timeout')
      };
      const deps = makeMockDeps({ findFirst: { id: 'f1', status: 'expired' } }, storage);
      const handler = makeHandleCleanupFile(deps);

      // Not the last attempt (attemptsMade=0 of 3)
      await expect(handler(makeJob({}, { attemptsMade: 0, attempts: 3 }))).rejects.toThrow(
        'network timeout'
      );
    });

    test('records anomaly on last transient retry before rethrowing', async () => {
      const db: DbStubs = {};
      const err = makeStorageError('transient', 'connection refused');
      const storage: StorageStubs = { deleteShouldThrow: err };
      const deps = makeMockDeps(db, storage);
      const handler = makeHandleCleanupFile(deps);

      // Last attempt: attemptsMade=2, attempts=3 → (2 + 1 >= 3)
      await expect(
        handler(makeJob({ fileId: 'trans-id' }, { attemptsMade: 2, attempts: 3 }))
      ).rejects.toThrow('connection refused');

      expect(db.capturedAnomalies).toHaveLength(1);
      expect(db.capturedAnomalies?.[0]?.type).toBe('failed_cleanup');
    });

    test('does not record anomaly on non-last transient retry', async () => {
      const db: DbStubs = {};
      const storage: StorageStubs = {
        deleteShouldThrow: makeStorageError('transient')
      };
      const deps = makeMockDeps(db, storage);
      const handler = makeHandleCleanupFile(deps);

      // First attempt: attemptsMade=0, attempts=3 → (0 + 1 < 3, not last)
      await expect(handler(makeJob({}, { attemptsMade: 0, attempts: 3 }))).rejects.toThrow();

      expect(db.capturedAnomalies).toHaveLength(0);
    });
  });
});
