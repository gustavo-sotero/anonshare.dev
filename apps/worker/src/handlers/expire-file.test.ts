import { describe, expect, test } from 'bun:test';
import {
  type CleanupFileJobPayload,
  type ExpireFileJobPayload,
  LIFECYCLE_JOB_RETENTION
} from '@anonshare/contracts';
import type { createDb } from '@anonshare/infrastructure/db';
import type { Job, Queue } from 'bullmq';
import { type ExpireFileHandlerDeps, makeHandleExpireFile } from './expire-file';

// ── Test-double helpers ───────────────────────────────────────────────────────

type FileRow = {
  id: string;
  objectKey: string;
  status: string;
  expiresAt: Date | null;
};

type DbStubs = {
  findFirst?: FileRow | null;
  findFirstShouldThrow?: boolean;
  updateReturn?: { id: string }[];
  updateShouldThrow?: boolean;
};

type CleanupQueueStubs = {
  capturedAdds?: Array<{ name: string; data: CleanupFileJobPayload; opts: unknown }>;
  shouldThrow?: boolean;
};

function makeFileRow(overrides: Partial<FileRow> = {}): FileRow {
  return {
    id: 'file-uuid-1',
    objectKey: 'objects/test-key',
    status: 'active',
    expiresAt: new Date(Date.now() - 60_000), // 1 minute ago
    ...overrides
  };
}

function makeMockDeps(db: DbStubs = {}, queue: CleanupQueueStubs = {}): ExpireFileHandlerDeps {
  const capturedAdds: Array<{ name: string; data: CleanupFileJobPayload; opts: unknown }> = [];
  queue.capturedAdds = capturedAdds;

  return {
    db: {
      query: {
        files: {
          findFirst: async (_opts: unknown) => {
            if (db.findFirstShouldThrow) throw new Error('DB query failed');
            return db.findFirst !== undefined ? db.findFirst : makeFileRow();
          }
        }
      },
      update: (_tbl: unknown) => ({
        set: (_vals: unknown) => ({
          where: (_cond: unknown) => ({
            returning: async (_cols: unknown) => {
              if (db.updateShouldThrow) throw new Error('DB update failed');
              return db.updateReturn ?? [{ id: 'file-uuid-1' }];
            }
          })
        })
      })
    } as unknown as ReturnType<typeof createDb>,

    cleanupQueue: {
      add: async (name: string, data: CleanupFileJobPayload, opts: unknown) => {
        if (queue.shouldThrow) throw new Error('Queue unavailable');
        capturedAdds.push({ name, data, opts });
        return {} as ReturnType<Queue['add']>;
      }
    } as unknown as Queue<CleanupFileJobPayload>
  };
}

function makeJob(fileId: string): Job<ExpireFileJobPayload> {
  return { data: { fileId } } as Job<ExpireFileJobPayload>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('expire-file handler', () => {
  describe('idempotent skip paths', () => {
    test('resolves without action when file is not found', async () => {
      const queue: CleanupQueueStubs = {};
      const deps = makeMockDeps({ findFirst: null }, queue);
      const handler = makeHandleExpireFile(deps);

      await expect(handler(makeJob('missing-uuid'))).resolves.toBeUndefined();
      expect(queue.capturedAdds).toHaveLength(0);
    });

    test('enqueues cleanup when file status is already expired', async () => {
      const queue: CleanupQueueStubs = {};
      const deps = makeMockDeps(
        { findFirst: makeFileRow({ status: 'expired' }), updateShouldThrow: true },
        queue
      );
      const handler = makeHandleExpireFile(deps);

      await expect(handler(makeJob('file-uuid-1'))).resolves.toBeUndefined();
      expect(queue.capturedAdds).toHaveLength(1);
      expect(queue.capturedAdds?.at(0)?.name).toBe('cleanup-file');
      expect(queue.capturedAdds?.at(0)?.data.fileId).toBe('file-uuid-1');
    });

    test('resolves without action when file status is consumed', async () => {
      const queue: CleanupQueueStubs = {};
      const deps = makeMockDeps({ findFirst: makeFileRow({ status: 'consumed' }) }, queue);
      const handler = makeHandleExpireFile(deps);

      await expect(handler(makeJob('file-uuid-1'))).resolves.toBeUndefined();
      expect(queue.capturedAdds).toHaveLength(0);
    });

    test('resolves without action when file status is deleted', async () => {
      const queue: CleanupQueueStubs = {};
      const deps = makeMockDeps({ findFirst: makeFileRow({ status: 'deleted' }) }, queue);
      const handler = makeHandleExpireFile(deps);

      await expect(handler(makeJob('file-uuid-1'))).resolves.toBeUndefined();
      expect(queue.capturedAdds).toHaveLength(0);
    });

    test('resolves (with warning) when expiresAt is null', async () => {
      const queue: CleanupQueueStubs = {};
      const deps = makeMockDeps({ findFirst: makeFileRow({ expiresAt: null }) }, queue);
      const handler = makeHandleExpireFile(deps);

      await expect(handler(makeJob('file-uuid-1'))).resolves.toBeUndefined();
      expect(queue.capturedAdds).toHaveLength(0);
    });

    test('resolves (with warning) when expiresAt is in the future', async () => {
      const future = new Date(Date.now() + 60_000); // 1 minute ahead
      const queue: CleanupQueueStubs = {};
      const deps = makeMockDeps({ findFirst: makeFileRow({ expiresAt: future }) }, queue);
      const handler = makeHandleExpireFile(deps);

      await expect(handler(makeJob('file-uuid-1'))).resolves.toBeUndefined();
      expect(queue.capturedAdds).toHaveLength(0);
    });

    test('resolves without action when concurrent UPDATE already changed the status (0 rows returned)', async () => {
      const queue: CleanupQueueStubs = {};
      const deps = makeMockDeps({ updateReturn: [] }, queue);
      const handler = makeHandleExpireFile(deps);

      await expect(handler(makeJob('file-uuid-1'))).resolves.toBeUndefined();
      expect(queue.capturedAdds).toHaveLength(0);
    });
  });

  describe('successful expiration', () => {
    test('transitions active file to expired and enqueues cleanup job', async () => {
      const queue: CleanupQueueStubs = {};
      const file = makeFileRow({ id: 'abc-123', objectKey: 'objects/abc', status: 'active' });
      const deps = makeMockDeps({ findFirst: file, updateReturn: [{ id: 'abc-123' }] }, queue);
      const handler = makeHandleExpireFile(deps);

      await handler(makeJob('abc-123'));

      expect(queue.capturedAdds).toHaveLength(1);
      expect(queue.capturedAdds?.at(0)?.name).toBe('cleanup-file');
      expect(queue.capturedAdds?.at(0)?.data.fileId).toBe('abc-123');
      expect(queue.capturedAdds?.at(0)?.data.objectKey).toBe('objects/abc');
    });

    test('transitions expiring file to expired and enqueues cleanup job', async () => {
      const queue: CleanupQueueStubs = {};
      const file = makeFileRow({ id: 'exp-456', objectKey: 'objects/exp', status: 'expiring' });
      const deps = makeMockDeps({ findFirst: file, updateReturn: [{ id: 'exp-456' }] }, queue);
      const handler = makeHandleExpireFile(deps);

      await handler(makeJob('exp-456'));

      expect(queue.capturedAdds).toHaveLength(1);
      expect(queue.capturedAdds?.[0]?.data.fileId).toBe('exp-456');
    });

    test('uses deduplication jobId containing the fileId for cleanup job', async () => {
      const queue: CleanupQueueStubs = {};
      const file = makeFileRow({ id: 'ded-789' });
      const deps = makeMockDeps({ findFirst: file, updateReturn: [{ id: 'ded-789' }] }, queue);
      const handler = makeHandleExpireFile(deps);

      await handler(makeJob('ded-789'));

      const opts = queue.capturedAdds?.[0]?.opts as { jobId?: string };
      expect(opts.jobId).toBe('cleanup:ded-789');
    });

    test('cleanup job is configured with retry, backoff, and retention policy', async () => {
      const queue: CleanupQueueStubs = {};
      const file = makeFileRow({ id: 'retry-1' });
      const deps = makeMockDeps({ findFirst: file, updateReturn: [{ id: 'retry-1' }] }, queue);
      const handler = makeHandleExpireFile(deps);

      await handler(makeJob('retry-1'));

      const opts = queue.capturedAdds?.[0]?.opts as {
        attempts?: number;
        backoff?: { type: string };
        removeOnComplete?: number;
        removeOnFail?: number;
      };
      expect(opts.attempts).toBeGreaterThan(1);
      expect(opts.backoff?.type).toBe('exponential');
      expect(opts.removeOnComplete).toBe(LIFECYCLE_JOB_RETENTION.removeOnComplete);
      expect(opts.removeOnFail).toBe(LIFECYCLE_JOB_RETENTION.removeOnFail);
    });
  });
});
