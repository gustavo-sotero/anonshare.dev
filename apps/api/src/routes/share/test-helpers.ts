/**
 * Shared test doubles and builders for the share route test suite.
 * Imported by the per-route test files (meta, download, preview).
 */

import type { Redis } from '@anonshare/infrastructure/redis';
import { Hono } from 'hono';
import { createShareRouter, type ShareRouterDeps } from './index';

export type FileRow = {
  id: string;
  token: string;
  objectKey: string;
  sanitizedFilename: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  oneTimeDownload: boolean;
  allowPreview: boolean;
  expiresAt: Date | null;
  uploadedAt: Date;
  consumedAt: Date | null;
};

export type DbStubs = {
  findFirst?: FileRow | null | undefined;
  findFirstShouldThrow?: boolean;
  updateReturn?: Array<{ id: string; objectKey: string }>;
  updateSequence?: unknown[];
  updateShouldThrow?: boolean;
  updateShouldThrowAtCall?: number[];
  onUpdateSet?: (values: unknown) => void;
  onInsertValues?: (values: unknown) => void;
  insertShouldThrow?: boolean;
};

export type StorageStubs = {
  signedUrl?: string;
  createSignedUrlShouldThrow?: boolean;
  objectBody?: string;
  getObjectShouldThrow?: boolean;
  missingObject?: boolean;
};

export type QueueStubs = {
  capturedCleanupEnqueues?: Array<{ fileId: string; objectKey: string; delayMs?: number }>;
  cleanupShouldThrow?: boolean;
};

export function makeFileRow(overrides: Partial<FileRow> = {}): FileRow {
  return {
    id: 'file-uuid-1',
    token: 'Abc123defghijkl012',
    objectKey: 'objects/test-uuid',
    sanitizedFilename: 'test-file.txt',
    mimeType: 'text/plain',
    sizeBytes: 4096,
    status: 'active',
    oneTimeDownload: false,
    allowPreview: false,
    expiresAt: null,
    uploadedAt: new Date('2025-01-01T00:00:00Z'),
    consumedAt: null,
    ...overrides
  };
}

export function makeMockDeps(
  db: DbStubs = {},
  storage: StorageStubs = {},
  queue: QueueStubs = {}
): ShareRouterDeps {
  let updateCallCount = 0;
  const capturedCleanupEnqueues: Array<{ fileId: string; objectKey: string; delayMs?: number }> =
    [];
  queue.capturedCleanupEnqueues = capturedCleanupEnqueues;

  return {
    getDb: () =>
      ({
        query: {
          files: {
            findFirst: async (_opts: unknown) => {
              if (db.findFirstShouldThrow) throw new Error('DB query failed');
              return db.findFirst ?? null;
            }
          }
        },
        update: (_tbl: unknown) => ({
          set: (vals: unknown) => ({
            where: (_cond: unknown) => ({
              returning: async (_cols: unknown) => {
                updateCallCount += 1;
                db.onUpdateSet?.(vals);

                if (db.updateShouldThrow) throw new Error('DB update failed');
                if (db.updateShouldThrowAtCall?.includes(updateCallCount)) {
                  throw new Error('DB update failed');
                }

                if (db.updateSequence && db.updateSequence.length >= updateCallCount) {
                  const value = db.updateSequence[updateCallCount - 1];
                  return (value ?? []) as Array<{ id: string; objectKey: string }>;
                }

                return db.updateReturn ?? [];
              }
            })
          })
        }),
        insert: (_tbl: unknown) => ({
          values: (vals: unknown) => {
            db.onInsertValues?.(vals);
            if (db.insertShouldThrow) {
              return Promise.reject(new Error('DB insert failed'));
            }
            return Promise.resolve();
          }
        })
      }) as unknown as ReturnType<Required<ShareRouterDeps>['getDb']>,

    storage: {
      createSignedUrl: async (_key: string, _opts: unknown) => {
        if (storage.createSignedUrlShouldThrow) throw new Error('Storage presign failed');
        return storage.signedUrl ?? 'https://storage.example.com/presigned-url?sig=abc123';
      },
      getObject: async (_key: string) => {
        if (storage.getObjectShouldThrow) throw new Error('Storage read failed');
        if (storage.missingObject) return null;

        const body = storage.objectBody ?? 'preview body';
        return new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(body));
            controller.close();
          }
        });
      }
    },

    enqueueCleanupFile: async (fileId: string, objectKey: string, delayMs?: number) => {
      if (queue.cleanupShouldThrow) {
        throw new Error('Cleanup queue unavailable');
      }

      capturedCleanupEnqueues.push({
        fileId,
        objectKey,
        ...(delayMs === undefined ? {} : { delayMs })
      });
    }
  };
}

export function buildApp(deps?: ShareRouterDeps): Hono {
  const app = new Hono();
  app.route('/share', createShareRouter(deps));
  return app;
}

/**
 * Minimal Redis double for share route rate-limit path testing.
 * `count` is the value returned by INCR — anything > the limit triggers a 429.
 */
export function makeRedis(
  opts: {
    count?: number;
    counts?: number[];
    shouldThrow?: boolean;
    onIncr?: (key: string) => void;
  } = {}
): Redis {
  const count = opts.count ?? 1;
  const counts = opts.counts;
  const shouldThrow = opts.shouldThrow ?? false;
  const onIncr = opts.onIncr;
  let call = 0;
  return {
    incr: async (key: string) => {
      if (shouldThrow) {
        throw new Error('redis unavailable');
      }

      onIncr?.(key);

      if (counts && counts.length > 0) {
        const next = counts[Math.min(call, counts.length - 1)];
        call += 1;
        return next ?? count;
      }

      return count;
    },
    expire: async () => 1,
    ttl: async () => 59
  } as unknown as Redis;
}

export async function request(app: Hono, path: string): Promise<Response> {
  return app.request(`http://localhost${path}`, { method: 'GET' });
}
