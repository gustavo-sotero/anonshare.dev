import type { Redis } from '@anonshare/infrastructure/redis';
import { confirmStoredObject } from '@anonshare/infrastructure/storage';
import { Hono } from 'hono';
import { createUploadRouter } from './index';
import type { UploadRouterDeps } from './types';

type DbStubs = {
  insertShouldThrow?: boolean;
  insertReturn?: { id: string }[];
  captureInsertValues?: (values: unknown) => void;
  updateReturn?: { id: string }[];
  updateShouldThrow?: boolean;
  deleteShouldThrow?: boolean;
  captureUpdateSet?: (values: unknown) => void;
};

type StorageStubs = {
  deleteShouldThrow?: boolean;
  captureDelete?: (key: string) => void;
  putShouldThrow?: boolean;
  headShouldThrow?: boolean;
  headImpl?: (key: string) => Promise<{ contentType: string; contentLength: number } | null>;
  headReturn?: { contentType: string; contentLength: number } | null;
  capturePut?: (obj: unknown) => void;
};

type QueueStubs = {
  captureExpireEnqueue?: (fileId: string, delayMs: number) => void;
  enqueueExpireShouldThrow?: boolean;
  captureCleanupEnqueue?: (fileId: string, objectKey: string, delayMs: number | undefined) => void;
  enqueueCleanupShouldThrow?: boolean;
};

/**
 * Builds minimal injectable deps for the upload router.
 * The DB double implements only the Drizzle chain surface called by the handler.
 */
export function makeMockDeps(
  db: DbStubs = {},
  storage: StorageStubs = {},
  queue: QueueStubs = {}
): UploadRouterDeps {
  const insertReturn = db.insertReturn ?? [{ id: 'test-file-id' }];
  const updateReturn = db.updateReturn ?? [{ id: insertReturn[0]?.id ?? 'test-file-id' }];
  let lastPut: {
    contentLength: number | undefined;
    contentType: string | undefined;
  } | null = null;

  return {
    getDb: () =>
      ({
        insert: (_tbl: unknown) => ({
          values: (vals: unknown) => ({
            returning: async (_cols: unknown) => {
              db.captureInsertValues?.(vals);
              if (db.insertShouldThrow) throw new Error('DB insert failed');
              return insertReturn;
            }
          })
        }),
        update: (_tbl: unknown) => ({
          set: (values: unknown) => ({
            where: (_cond: unknown) => ({
              returning: async (_cols: unknown) => {
                db.captureUpdateSet?.(values);

                if (db.updateShouldThrow) throw new Error('DB update failed');
                return updateReturn;
              }
            })
          })
        }),
        delete: (_tbl: unknown) => ({
          where: async (_cond: unknown) => {
            if (db.deleteShouldThrow) throw new Error('DB delete failed');
          }
        })
      }) as unknown as ReturnType<Required<UploadRouterDeps>['getDb']>,

    storage: {
      putConfirmed: async (obj: unknown) => {
        storage.capturePut?.(obj);

        if (
          typeof obj === 'object' &&
          obj !== null &&
          'contentLength' in obj &&
          'contentType' in obj
        ) {
          lastPut = {
            contentLength: (obj as { contentLength?: number }).contentLength,
            contentType: (obj as { contentType?: string }).contentType
          };
        }

        if (storage.putShouldThrow) throw new Error('Storage: connection refused');
        await confirmStoredObject(
          {
            head: async (_key: string) => {
              if (storage.headImpl) {
                return storage.headImpl(_key);
              }

              if (storage.headShouldThrow) throw new Error('Storage head failed');
              if (storage.headReturn !== undefined) return storage.headReturn;

              return {
                contentLength: lastPut?.contentLength ?? 1024,
                contentType: lastPut?.contentType ?? 'application/octet-stream'
              };
            }
          },
          (obj as { key: string }).key,
          lastPut?.contentLength
        );
      },
      delete: async (key: string) => {
        storage.captureDelete?.(key);
        if (storage.deleteShouldThrow) throw new Error('Storage delete failed');
      }
    },

    enqueueExpireFile: async (fileId: string, delayMs: number) => {
      queue.captureExpireEnqueue?.(fileId, delayMs);

      if (queue.enqueueExpireShouldThrow) {
        throw new Error('Expire queue unavailable');
      }
    },

    enqueueCleanupFile: async (fileId: string, objectKey: string, delayMs?: number) => {
      queue.captureCleanupEnqueue?.(fileId, objectKey, delayMs);

      if (queue.enqueueCleanupShouldThrow) {
        throw new Error('Cleanup queue unavailable');
      }
    }
  };
}

export function makeFile(sizeBytes = 1024, name = 'test.txt', type = 'text/plain'): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

export function makeFutureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString();
}

export function yesterdayIso(): string {
  return new Date(Date.now() - 86_400_000).toISOString();
}

/**
 * Minimal Redis double for rate-limit path testing.
 * `count` is the value returned by INCR — anything > the limit triggers a 429.
 */
export function makeRedis(opts: { count?: number } = {}): Redis {
  const count = opts.count ?? 1;
  return {
    incr: async (_key: string) => count,
    expire: async () => 1,
    ttl: async () => 3599
  } as unknown as Redis;
}

export function makeFailingRedis(): Redis {
  return {
    incr: async () => {
      throw new Error('redis unavailable');
    },
    expire: async () => 1,
    ttl: async () => 3599
  } as unknown as Redis;
}

/** Mount the upload router under /upload and return the composite app. */
export function buildApp(deps?: UploadRouterDeps): Hono {
  const app = new Hono();
  app.route('/upload', createUploadRouter(deps));
  return app;
}

/**
 * Fire POST /upload with a FormData built from `fields`.
 * Fields with a `null` value are omitted entirely (not appended to the form).
 */
export async function postUpload(
  app: Hono,
  fields: {
    file?: File;
    oneTime?: boolean;
    allowPreview?: boolean;
    expiresAt?: string | null;
  },
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  const form = new FormData();
  if (fields.file !== undefined) form.append('file', fields.file);
  if (fields.oneTime !== undefined) form.append('oneTime', String(fields.oneTime));
  if (fields.allowPreview !== undefined) form.append('allowPreview', String(fields.allowPreview));
  if (fields.expiresAt != null) form.append('expiresAt', fields.expiresAt);

  return app.request('http://localhost/upload', {
    method: 'POST',
    headers: extraHeaders,
    body: form
  });
}
