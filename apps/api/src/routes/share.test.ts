import { describe, expect, test } from 'bun:test';
import { API_ERROR_CODES } from '@anonshare/contracts';
import type { Redis } from '@anonshare/infrastructure/redis';
import { Hono } from 'hono';
import { createShareRouter, type ShareRouterDeps } from './share';

// ── Test-double helpers ───────────────────────────────────────────────────────

type FileRow = {
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

type DbStubs = {
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

type StorageStubs = {
  signedUrl?: string;
  createSignedUrlShouldThrow?: boolean;
};

type QueueStubs = {
  capturedCleanupEnqueues?: Array<{ fileId: string; objectKey: string; delayMs?: number }>;
  cleanupShouldThrow?: boolean;
};

function makeFileRow(overrides: Partial<FileRow> = {}): FileRow {
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

function makeMockDeps(
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

function buildApp(deps?: ShareRouterDeps): Hono {
  const app = new Hono();
  app.route('/share', createShareRouter(deps));
  return app;
}

/**
 * Minimal Redis double for share route rate-limit path testing.
 * `count` is the value returned by INCR — anything > the limit triggers a 429.
 */
function makeRedis(
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

async function request(app: Hono, path: string): Promise<Response> {
  return app.request(`http://localhost${path}`, { method: 'GET' });
}

// ── GET /:token ───────────────────────────────────────────────────────────────

describe('GET /share/:token — metadata', () => {
  test('returns 200 with file metadata for an active file', async () => {
    const app = buildApp(makeMockDeps({ findFirst: makeFileRow() }));
    const res = await request(app, '/share/Abc123defghijkl012');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.data.filename).toBe('test-file.txt');
    expect(body.data.status).toBe('active');
    expect(body.data.sizeBytes).toBe(4096);
    expect(body.data.mimeType).toBe('text/plain');
    expect(body.data.oneTime).toBe(false);
    expect(body.data.allowPreview).toBe(false);
    expect(body.data.expiresAt).toBeNull();
    expect(body.data.unavailabilityMessage).toBeUndefined();
  });

  test('returns 200 for an expiring file', async () => {
    const app = buildApp(
      makeMockDeps({
        findFirst: makeFileRow({
          status: 'expiring',
          expiresAt: new Date('2030-12-01T00:00:00Z')
        })
      })
    );
    const res = await request(app, '/share/Abc123defghijkl012');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe('expiring');
  });

  test('returns 404 when token does not match any file', async () => {
    const app = buildApp(makeMockDeps({ findFirst: null }));
    const res = await request(app, '/share/Abc123defghijkl012');

    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.NOT_FOUND);
  });

  test('returns 404 for malformed token without querying the database', async () => {
    const app = buildApp(makeMockDeps({ findFirstShouldThrow: true }));
    const res = await request(app, '/share/bad!');

    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.NOT_FOUND);
  });

  test('returns 410 FILE_EXPIRED for expired files', async () => {
    const app = buildApp(makeMockDeps({ findFirst: makeFileRow({ status: 'expired' }) }));
    const res = await request(app, '/share/Abc123defghijkl012');

    expect(res.status).toBe(410);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.FILE_EXPIRED);
  });

  test('returns 410 FILE_EXPIRED when active file is past expiresAt timestamp', async () => {
    const app = buildApp(
      makeMockDeps({
        findFirst: makeFileRow({
          status: 'active',
          expiresAt: new Date(Date.now() - 60_000)
        })
      })
    );
    const res = await request(app, '/share/Abc123defghijkl012');

    expect(res.status).toBe(410);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.FILE_EXPIRED);
  });

  test('returns 410 FILE_CONSUMED for consumed files', async () => {
    const app = buildApp(makeMockDeps({ findFirst: makeFileRow({ status: 'consumed' }) }));
    const res = await request(app, '/share/Abc123defghijkl012');

    expect(res.status).toBe(410);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.error.code).toBe(API_ERROR_CODES.FILE_CONSUMED);
  });

  test('returns 410 FILE_HIDDEN for hidden files', async () => {
    const app = buildApp(makeMockDeps({ findFirst: makeFileRow({ status: 'hidden' }) }));
    const res = await request(app, '/share/Abc123defghijkl012');

    expect(res.status).toBe(410);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.error.code).toBe(API_ERROR_CODES.FILE_HIDDEN);
  });

  test('returns 410 FILE_DELETED for deleted files', async () => {
    const app = buildApp(makeMockDeps({ findFirst: makeFileRow({ status: 'deleted' }) }));
    const res = await request(app, '/share/Abc123defghijkl012');

    expect(res.status).toBe(410);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.error.code).toBe(API_ERROR_CODES.FILE_DELETED);
  });

  test('returns 410 FILE_UNAVAILABLE for pending_upload files', async () => {
    const app = buildApp(makeMockDeps({ findFirst: makeFileRow({ status: 'pending_upload' }) }));
    const res = await request(app, '/share/Abc123defghijkl012');

    expect(res.status).toBe(410);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.error.code).toBe(API_ERROR_CODES.FILE_UNAVAILABLE);
  });

  test('returns 410 FILE_UNAVAILABLE for missing files (storage object absent)', async () => {
    // `missing` status means metadata exists but the object is absent in storage.
    // It must not disclose internal state — FILE_UNAVAILABLE is the correct code.
    const app = buildApp(makeMockDeps({ findFirst: makeFileRow({ status: 'missing' }) }));
    const res = await request(app, '/share/Abc123defghijkl012');

    expect(res.status).toBe(410);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.FILE_UNAVAILABLE);
  });

  test('returns 500 when database query fails', async () => {
    const app = buildApp(makeMockDeps({ findFirstShouldThrow: true }));
    const res = await request(app, '/share/Abc123defghijkl012');

    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.error.code).toBe(API_ERROR_CODES.INTERNAL_ERROR);
  });

  test('returns 429 when per-IP metadata rate limit is exceeded', async () => {
    const app = buildApp({
      ...makeMockDeps({ findFirst: makeFileRow() }),
      getRedis: () => makeRedis({ count: 31 })
    });

    const res = await app.request('http://localhost/share/Abc123defghijkl012', {
      method: 'GET',
      headers: { 'x-forwarded-for': '10.0.0.1' }
    });

    expect(res.status).toBe(429);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.RATE_LIMITED);
  });

  test('uses the configured download rate limit loader for metadata requests', async () => {
    const app = buildApp({
      ...makeMockDeps({ findFirst: makeFileRow() }),
      getRedis: () => makeRedis({ count: 6 }),
      loadDownloadRateLimit: async () => 5
    });

    const res = await app.request('http://localhost/share/Abc123defghijkl012', {
      method: 'GET',
      headers: { 'x-forwarded-for': '10.0.0.1' }
    });

    expect(res.status).toBe(429);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.RATE_LIMITED);
  });

  test('returns 429 when per-token metadata rate limit is exceeded', async () => {
    const redis = makeRedis({ counts: [1, 13] });
    const app = buildApp({
      ...makeMockDeps({ findFirst: makeFileRow() }),
      // First increment (per-IP) passes, second increment (per-token) exceeds limit.
      getRedis: () => redis
    });

    const res = await app.request('http://localhost/share/Abc123defghijkl012', {
      method: 'GET',
      headers: { 'x-forwarded-for': '10.0.0.1' }
    });

    expect(res.status).toBe(429);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.RATE_LIMITED);
  });

  test('bypasses metadata rate limiting when no IP header is present', async () => {
    const app = buildApp(makeMockDeps({ findFirst: makeFileRow() }));
    const res = await request(app, '/share/Abc123defghijkl012');

    expect(res.status).toBe(200);
  });

  test('continues metadata response when rate limiter backend is unavailable', async () => {
    const app = buildApp({
      ...makeMockDeps({ findFirst: makeFileRow() }),
      getRedis: () => makeRedis({ shouldThrow: true })
    });

    const res = await app.request('http://localhost/share/Abc123defghijkl012', {
      method: 'GET',
      headers: { 'x-forwarded-for': '10.0.0.1' }
    });

    expect(res.status).toBe(200);
  });
});

// ── GET /:token/download ──────────────────────────────────────────────────────

describe('GET /share/:token/download — standard download', () => {
  test('records started and completed events server-side when URL is issued', async () => {
    const insertedEventTypes: string[] = [];
    const app = buildApp(
      makeMockDeps(
        {
          findFirst: makeFileRow({ oneTimeDownload: false }),
          onInsertValues: (values) => {
            if (typeof values !== 'object' || values === null || !('eventType' in values)) {
              return;
            }

            insertedEventTypes.push(String((values as { eventType: unknown }).eventType));
          }
        },
        { signedUrl: 'https://storage.example.com/dl?token=xyz' }
      )
    );

    const res = await request(app, '/share/Abc123defghijkl012/download');

    expect(res.status).toBe(200);
    expect(insertedEventTypes).toEqual(['started', 'completed']);
  });

  test('returns presigned URL for an active standard file', async () => {
    const app = buildApp(
      makeMockDeps(
        { findFirst: makeFileRow({ oneTimeDownload: false }) },
        { signedUrl: 'https://storage.example.com/dl?token=xyz' }
      )
    );
    const res = await request(app, '/share/Abc123defghijkl012/download');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { url: string; expiresAt: string } };
    expect(body.ok).toBe(true);
    expect(body.data.url).toBe('https://storage.example.com/dl?token=xyz');
    expect(typeof body.data.expiresAt).toBe('string');
  });

  test('returns 404 for unknown token', async () => {
    const app = buildApp(makeMockDeps({ findFirst: null }));
    const res = await request(app, '/share/Abc123defghijkl012/download');

    expect(res.status).toBe(404);
  });

  test('returns 404 for malformed token without querying the database', async () => {
    const app = buildApp(makeMockDeps({ findFirstShouldThrow: true }));
    const res = await request(app, '/share/bad!/download');

    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.NOT_FOUND);
  });

  test('returns 200 presigned URL for an expiring standard file', async () => {
    // `expiring` is publicly accessible — downloads must still succeed.
    const app = buildApp(
      makeMockDeps(
        {
          findFirst: makeFileRow({
            status: 'expiring',
            oneTimeDownload: false,
            expiresAt: new Date(Date.now() + 60_000)
          })
        },
        { signedUrl: 'https://storage.example.com/expiring-dl' }
      )
    );
    const res = await request(app, '/share/Abc123defghijkl012/download');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { url: string } };
    expect(body.ok).toBe(true);
    expect(body.data.url).toBe('https://storage.example.com/expiring-dl');
  });

  test('returns 410 for expired file', async () => {
    const app = buildApp(makeMockDeps({ findFirst: makeFileRow({ status: 'expired' }) }));
    const res = await request(app, '/share/Abc123defghijkl012/download');

    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe(API_ERROR_CODES.FILE_EXPIRED);
  });

  test('returns 410 and records blocked event when active file is past expiresAt timestamp', async () => {
    const insertedEvents: Array<{ eventType?: unknown; ipHash?: unknown }> = [];
    const app = buildApp(
      makeMockDeps({
        findFirst: makeFileRow({
          status: 'active',
          expiresAt: new Date(Date.now() - 60_000)
        }),
        onInsertValues: (values) => {
          if (typeof values === 'object' && values !== null) {
            insertedEvents.push(values as { eventType?: unknown; ipHash?: unknown });
          }
        }
      })
    );
    const res = await request(app, '/share/Abc123defghijkl012/download');

    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe(API_ERROR_CODES.FILE_EXPIRED);
    expect(insertedEvents).toContainEqual(
      expect.objectContaining({ eventType: 'blocked', ipHash: null })
    );
  });

  test('returns 410 for consumed file', async () => {
    const app = buildApp(makeMockDeps({ findFirst: makeFileRow({ status: 'consumed' }) }));
    const res = await request(app, '/share/Abc123defghijkl012/download');

    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe(API_ERROR_CODES.FILE_CONSUMED);
  });

  test('returns 410 FILE_HIDDEN for hidden files', async () => {
    const app = buildApp(makeMockDeps({ findFirst: makeFileRow({ status: 'hidden' }) }));
    const res = await request(app, '/share/Abc123defghijkl012/download');

    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe(API_ERROR_CODES.FILE_HIDDEN);
  });

  test('returns 410 FILE_DELETED for deleted files', async () => {
    const app = buildApp(makeMockDeps({ findFirst: makeFileRow({ status: 'deleted' }) }));
    const res = await request(app, '/share/Abc123defghijkl012/download');

    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe(API_ERROR_CODES.FILE_DELETED);
  });

  test('returns 410 FILE_UNAVAILABLE for missing files (object absent in storage)', async () => {
    const app = buildApp(makeMockDeps({ findFirst: makeFileRow({ status: 'missing' }) }));
    const res = await request(app, '/share/Abc123defghijkl012/download');

    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe(API_ERROR_CODES.FILE_UNAVAILABLE);
  });

  test('returns 500 when presigned URL generation fails', async () => {
    const app = buildApp(
      makeMockDeps(
        { findFirst: makeFileRow({ oneTimeDownload: false }) },
        { createSignedUrlShouldThrow: true }
      )
    );
    const res = await request(app, '/share/Abc123defghijkl012/download');

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe(API_ERROR_CODES.INTERNAL_ERROR);
  });
});

describe('GET /share/:token/download — one-time consumption', () => {
  test('issues URL and transitions to consumed when UPDATE succeeds', async () => {
    const queue: QueueStubs = {};
    const app = buildApp(
      makeMockDeps(
        {
          findFirst: makeFileRow({ oneTimeDownload: true, status: 'active' }),
          updateReturn: [{ id: 'file-uuid-1', objectKey: 'objects/test-uuid' }]
        },
        { signedUrl: 'https://storage.example.com/one-time-dl' },
        queue
      )
    );
    const res = await request(app, '/share/Abc123defghijkl012/download');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { url: string } };
    expect(body.ok).toBe(true);
    expect(body.data.url).toBe('https://storage.example.com/one-time-dl');
    expect(queue.capturedCleanupEnqueues).toEqual([
      {
        fileId: 'file-uuid-1',
        objectKey: 'objects/test-uuid',
        delayMs: 16 * 60 * 1_000
      }
    ]);
  });

  test('rolls one-time status back when presigning fails after consumption', async () => {
    const updateSets: unknown[] = [];
    const app = buildApp(
      makeMockDeps(
        {
          findFirst: makeFileRow({ oneTimeDownload: true, status: 'active' }),
          updateSequence: [
            [{ id: 'file-uuid-1', objectKey: 'objects/test-uuid' }],
            [{ id: 'file-uuid-1' }]
          ],
          onUpdateSet: (values) => {
            updateSets.push(values);
          }
        },
        { createSignedUrlShouldThrow: true }
      )
    );

    const res = await request(app, '/share/Abc123defghijkl012/download');

    expect(res.status).toBe(500);
    expect(updateSets).toEqual([
      { status: 'consumed', consumedAt: expect.any(Date) },
      { status: 'active', consumedAt: null }
    ]);
  });

  test('still returns 500 when rollback fails after one-time presign error', async () => {
    const updateSets: unknown[] = [];
    const app = buildApp(
      makeMockDeps(
        {
          findFirst: makeFileRow({ oneTimeDownload: true, status: 'active' }),
          updateSequence: [[{ id: 'file-uuid-1', objectKey: 'objects/test-uuid' }]],
          updateShouldThrowAtCall: [2],
          onUpdateSet: (values) => {
            updateSets.push(values);
          }
        },
        { createSignedUrlShouldThrow: true }
      )
    );

    const res = await request(app, '/share/Abc123defghijkl012/download');

    expect(res.status).toBe(500);
    expect(updateSets).toEqual([
      { status: 'consumed', consumedAt: expect.any(Date) },
      { status: 'active', consumedAt: null }
    ]);
  });

  test('does not enqueue cleanup for standard downloads', async () => {
    const queue: QueueStubs = {};
    const app = buildApp(
      makeMockDeps(
        { findFirst: makeFileRow({ oneTimeDownload: false, status: 'active' }) },
        { signedUrl: 'https://storage.example.com/standard-dl' },
        queue
      )
    );

    const res = await request(app, '/share/Abc123defghijkl012/download');

    expect(res.status).toBe(200);
    expect(queue.capturedCleanupEnqueues).toHaveLength(0);
  });

  test('still returns 200 when cleanup enqueue fails after one-time delivery', async () => {
    const app = buildApp(
      makeMockDeps(
        {
          findFirst: makeFileRow({ oneTimeDownload: true, status: 'active' }),
          updateReturn: [{ id: 'file-uuid-1', objectKey: 'objects/test-uuid' }]
        },
        { signedUrl: 'https://storage.example.com/one-time-dl' },
        { cleanupShouldThrow: true }
      )
    );

    const res = await request(app, '/share/Abc123defghijkl012/download');

    expect(res.status).toBe(200);
  });

  test('returns 410 FILE_CONSUMED when UPDATE matches 0 rows (race lost)', async () => {
    const app = buildApp(
      makeMockDeps({
        findFirst: makeFileRow({ oneTimeDownload: true, status: 'active' }),
        updateReturn: [] // 0 rows — race lost
      })
    );
    const res = await request(app, '/share/Abc123defghijkl012/download');

    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe(API_ERROR_CODES.FILE_CONSUMED);
  });

  test('returns 500 when the consumption UPDATE throws', async () => {
    const app = buildApp(
      makeMockDeps({
        findFirst: makeFileRow({ oneTimeDownload: true, status: 'active' }),
        updateShouldThrow: true
      })
    );
    const res = await request(app, '/share/Abc123defghijkl012/download');

    expect(res.status).toBe(500);
  });

  test('returns 500 and rolls back one-time reservation when presign fails', async () => {
    const updateStatuses: string[] = [];
    const app = buildApp(
      makeMockDeps(
        {
          findFirst: makeFileRow({ oneTimeDownload: true, status: 'active' }),
          updateSequence: [
            [{ id: 'file-uuid-1', objectKey: 'objects/test-uuid' }],
            [{ id: 'file-uuid-1' }]
          ],
          onUpdateSet: (values) => {
            if (typeof values !== 'object' || values === null || !('status' in values)) {
              return;
            }

            updateStatuses.push(String((values as { status: unknown }).status));
          }
        },
        { createSignedUrlShouldThrow: true }
      )
    );

    const res = await request(app, '/share/Abc123defghijkl012/download');

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe(API_ERROR_CODES.INTERNAL_ERROR);
    expect(updateStatuses).toEqual(['consumed', 'active']);
  });

  test('restores expiring status when one-time presign fails after reservation', async () => {
    const updateStatuses: string[] = [];
    const app = buildApp(
      makeMockDeps(
        {
          findFirst: makeFileRow({ oneTimeDownload: true, status: 'expiring' }),
          updateSequence: [
            [{ id: 'file-uuid-1', objectKey: 'objects/test-uuid' }],
            [{ id: 'file-uuid-1' }]
          ],
          onUpdateSet: (values) => {
            if (typeof values !== 'object' || values === null || !('status' in values)) {
              return;
            }

            updateStatuses.push(String((values as { status: unknown }).status));
          }
        },
        { createSignedUrlShouldThrow: true }
      )
    );

    const res = await request(app, '/share/Abc123defghijkl012/download');

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe(API_ERROR_CODES.INTERNAL_ERROR);
    expect(updateStatuses).toEqual(['consumed', 'expiring']);
  });

  test('allows exactly one successful one-time download across concurrent requests', async () => {
    const app = buildApp(
      makeMockDeps(
        {
          findFirst: makeFileRow({ oneTimeDownload: true, status: 'active' }),
          updateSequence: [[{ id: 'file-uuid-1', objectKey: 'objects/test-uuid' }], [], []]
        },
        { signedUrl: 'https://storage.example.com/one-time-dl' }
      )
    );

    const responses = await Promise.all([
      request(app, '/share/Abc123defghijkl012/download'),
      request(app, '/share/Abc123defghijkl012/download'),
      request(app, '/share/Abc123defghijkl012/download')
    ]);

    const statuses = responses.map((res) => res.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 410)).toHaveLength(2);
  });

  test('returns 410 for a one-time file already in consumed status', async () => {
    const app = buildApp(
      makeMockDeps({ findFirst: makeFileRow({ oneTimeDownload: true, status: 'consumed' }) })
    );
    const res = await request(app, '/share/Abc123defghijkl012/download');

    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe(API_ERROR_CODES.FILE_CONSUMED);
  });

  test('issues URL for a one-time file with expiring status', async () => {
    const app = buildApp(
      makeMockDeps(
        {
          findFirst: makeFileRow({ oneTimeDownload: true, status: 'expiring' }),
          updateReturn: [{ id: 'file-uuid-1', objectKey: 'objects/test-uuid' }]
        },
        { signedUrl: 'https://storage.example.com/expiring-dl' }
      )
    );
    const res = await request(app, '/share/Abc123defghijkl012/download');

    expect(res.status).toBe(200);
  });
});

// ── GET /:token/preview ───────────────────────────────────────────────────────

describe('GET /share/:token/preview', () => {
  test('returns presigned URL for eligible preview', async () => {
    const app = buildApp(
      makeMockDeps(
        {
          findFirst: makeFileRow({
            allowPreview: true,
            mimeType: 'image/png',
            oneTimeDownload: false
          })
        },
        { signedUrl: 'https://storage.example.com/preview' }
      )
    );
    const res = await request(app, '/share/Abc123defghijkl012/preview');

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { url: string; mimeType: string; expiresAt: string };
    };
    expect(body.ok).toBe(true);
    expect(body.data.url).toBe('https://storage.example.com/preview');
    expect(body.data.mimeType).toBe('image/png');
  });

  test('returns 403 when allowPreview is false', async () => {
    const app = buildApp(
      makeMockDeps({
        findFirst: makeFileRow({ allowPreview: false, mimeType: 'image/png' })
      })
    );
    const res = await request(app, '/share/Abc123defghijkl012/preview');

    expect(res.status).toBe(403);
  });

  test('returns 403 for one-time download files', async () => {
    const app = buildApp(
      makeMockDeps({
        findFirst: makeFileRow({
          allowPreview: true,
          oneTimeDownload: true,
          mimeType: 'image/png'
        })
      })
    );
    const res = await request(app, '/share/Abc123defghijkl012/preview');

    expect(res.status).toBe(403);
  });

  test('returns 422 for unsupported MIME type', async () => {
    const app = buildApp(
      makeMockDeps({
        findFirst: makeFileRow({
          allowPreview: true,
          mimeType: 'application/zip',
          oneTimeDownload: false
        })
      })
    );
    const res = await request(app, '/share/Abc123defghijkl012/preview');

    expect(res.status).toBe(422);
  });

  test('returns 410 for unavailable file', async () => {
    const app = buildApp(
      makeMockDeps({
        findFirst: makeFileRow({ status: 'expired', allowPreview: true, mimeType: 'image/jpeg' })
      })
    );
    const res = await request(app, '/share/Abc123defghijkl012/preview');

    expect(res.status).toBe(410);
  });

  test('returns 410 FILE_EXPIRED when active file is past expiresAt timestamp', async () => {
    const app = buildApp(
      makeMockDeps({
        findFirst: makeFileRow({
          status: 'active',
          allowPreview: true,
          mimeType: 'image/png',
          expiresAt: new Date(Date.now() - 60_000)
        })
      })
    );
    const res = await request(app, '/share/Abc123defghijkl012/preview');

    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe(API_ERROR_CODES.FILE_EXPIRED);
  });

  test('returns 410 FILE_HIDDEN for hidden files', async () => {
    const app = buildApp(
      makeMockDeps({
        findFirst: makeFileRow({ status: 'hidden', allowPreview: true, mimeType: 'image/png' })
      })
    );
    const res = await request(app, '/share/Abc123defghijkl012/preview');

    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe(API_ERROR_CODES.FILE_HIDDEN);
  });

  test('returns 410 FILE_DELETED for deleted files', async () => {
    const app = buildApp(
      makeMockDeps({
        findFirst: makeFileRow({ status: 'deleted', allowPreview: true, mimeType: 'image/png' })
      })
    );
    const res = await request(app, '/share/Abc123defghijkl012/preview');

    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe(API_ERROR_CODES.FILE_DELETED);
  });

  test('returns 410 FILE_UNAVAILABLE for missing files', async () => {
    const app = buildApp(
      makeMockDeps({
        findFirst: makeFileRow({ status: 'missing', allowPreview: true, mimeType: 'image/png' })
      })
    );
    const res = await request(app, '/share/Abc123defghijkl012/preview');

    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe(API_ERROR_CODES.FILE_UNAVAILABLE);
  });

  test('returns 404 for unknown token', async () => {
    const app = buildApp(makeMockDeps({ findFirst: null }));
    const res = await request(app, '/share/Abc123defghijkl012/preview');

    expect(res.status).toBe(404);
  });

  test('returns 404 for malformed token without querying the database', async () => {
    const app = buildApp(makeMockDeps({ findFirstShouldThrow: true }));
    const res = await request(app, '/share/bad!/preview');

    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.NOT_FOUND);
  });

  test('returns 500 when presigned URL generation fails', async () => {
    const app = buildApp(
      makeMockDeps(
        {
          findFirst: makeFileRow({
            allowPreview: true,
            mimeType: 'text/plain',
            oneTimeDownload: false
          })
        },
        { createSignedUrlShouldThrow: true }
      )
    );
    const res = await request(app, '/share/Abc123defghijkl012/preview');

    expect(res.status).toBe(500);
  });

  test('supports all eligible MIME types', async () => {
    const eligible = [
      'image/jpeg',
      'image/png',
      'video/mp4',
      'audio/mpeg',
      'application/pdf',
      'text/plain',
      'text/markdown'
    ];

    for (const mimeType of eligible) {
      const app = buildApp(
        makeMockDeps(
          { findFirst: makeFileRow({ allowPreview: true, mimeType, oneTimeDownload: false }) },
          { signedUrl: 'https://storage.example.com/preview-url' }
        )
      );
      const res = await request(app, '/share/Abc123defghijkl012/preview');
      expect(res.status).toBe(200);
    }
  });
});

// ── Cache-Control headers ─────────────────────────────────────────────────────

describe('Cache-Control headers', () => {
  test('metadata 200 enforces mandatory revalidation cache header', async () => {
    const app = buildApp(makeMockDeps({ findFirst: makeFileRow() }));
    const res = await request(app, '/share/Abc123defghijkl012');

    expect(res.status).toBe(200);
    const cc = res.headers.get('cache-control');
    expect(cc).toContain('private');
    expect(cc).toContain('no-cache');
    expect(cc).toContain('max-age=0');
    expect(cc).toContain('must-revalidate');
  });

  test('metadata 404 sends no-store cache header', async () => {
    const app = buildApp(makeMockDeps({ findFirst: null }));
    const res = await request(app, '/share/Abc123defghijkl012');

    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('metadata 500 sends no-store cache header', async () => {
    const app = buildApp(makeMockDeps({ findFirstShouldThrow: true }));
    const res = await request(app, '/share/Abc123defghijkl012');

    expect(res.status).toBe(500);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('metadata 410 sends no-store cache header', async () => {
    const app = buildApp(makeMockDeps({ findFirst: makeFileRow({ status: 'expired' }) }));
    const res = await request(app, '/share/Abc123defghijkl012');

    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('metadata reflects hidden state on subsequent request after moderation transition', async () => {
    const app = buildApp(makeMockDeps({ findFirst: makeFileRow({ status: 'active' }) }));

    const first = await request(app, '/share/Abc123defghijkl012');
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toContain('must-revalidate');

    const secondApp = buildApp(makeMockDeps({ findFirst: makeFileRow({ status: 'hidden' }) }));
    const second = await request(secondApp, '/share/Abc123defghijkl012');

    expect(second.status).toBe(410);
    expect(second.headers.get('cache-control')).toBe('no-store');
    const body = (await second.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.FILE_HIDDEN);
  });

  test('download 200 sends no-store cache header', async () => {
    const app = buildApp(
      makeMockDeps(
        { findFirst: makeFileRow({ oneTimeDownload: false }) },
        { signedUrl: 'https://storage.example.com/dl' }
      )
    );
    const res = await request(app, '/share/Abc123defghijkl012/download');

    expect(res.status).toBe(200);
    const cc = res.headers.get('cache-control');
    expect(cc).toContain('no-store');
  });

  test('download 404 sends no-store cache header', async () => {
    const app = buildApp(makeMockDeps({ findFirst: null }));
    const res = await request(app, '/share/Abc123defghijkl012/download');

    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('download 410 sends no-store cache header', async () => {
    const app = buildApp(makeMockDeps({ findFirst: makeFileRow({ status: 'expired' }) }));
    const res = await request(app, '/share/Abc123defghijkl012/download');

    expect(res.status).toBe(410);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('preview 200 sends no-store cache header', async () => {
    const app = buildApp(
      makeMockDeps(
        { findFirst: makeFileRow({ allowPreview: true, mimeType: 'image/png' }) },
        { signedUrl: 'https://storage.example.com/preview' }
      )
    );
    const res = await request(app, '/share/Abc123defghijkl012/preview');

    expect(res.status).toBe(200);
    const cc = res.headers.get('cache-control');
    expect(cc).toContain('no-store');
  });

  test('preview 404 sends no-store cache header', async () => {
    const app = buildApp(makeMockDeps({ findFirst: null }));
    const res = await request(app, '/share/Abc123defghijkl012/preview');

    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('preview 410 sends no-store cache header', async () => {
    const app = buildApp(
      makeMockDeps({ findFirst: makeFileRow({ status: 'expired', allowPreview: true }) })
    );
    const res = await request(app, '/share/Abc123defghijkl012/preview');

    expect(res.status).toBe(410);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

// ── POST /:token/download/ack ─────────────────────────────────────────────────

describe('POST /share/:token/download/ack', () => {
  async function ack(app: Hono, token: string): Promise<Response> {
    return app.request(`http://localhost/share/${token}/download/ack`, { method: 'POST' });
  }

  test('returns 204 for a valid standard file', async () => {
    const app = buildApp(makeMockDeps({ findFirst: makeFileRow({ oneTimeDownload: false }) }));
    const res = await ack(app, 'Abc123defghijkl012');

    expect(res.status).toBe(204);
  });

  test('returns 204 for unknown token (best-effort, non-blocking)', async () => {
    const app = buildApp(makeMockDeps({ findFirst: null }));
    const res = await ack(app, 'Abc123defghijkl012');

    expect(res.status).toBe(204);
  });

  test('returns 204 for a one-time file (skips duplicate completed event)', async () => {
    const app = buildApp(
      makeMockDeps({ findFirst: makeFileRow({ oneTimeDownload: true, status: 'consumed' }) })
    );
    const res = await ack(app, 'Abc123defghijkl012');

    expect(res.status).toBe(204);
  });

  test('returns 204 even when DB query throws (best-effort)', async () => {
    const app = buildApp(makeMockDeps({ findFirstShouldThrow: true }));
    const res = await ack(app, 'Abc123defghijkl012');

    expect(res.status).toBe(204);
  });
});

// ── Rate limiting ─────────────────────────────────────────────────────────────

describe('GET /share/:token/download — rate limiting', () => {
  // SHARE_DOWNLOAD_RATE_LIMIT = 30 req/min; a count of 31 exceeds it.
  const OVER_LIMIT = 31;

  test('returns 429 when per-IP download rate limit is exceeded', async () => {
    const app = buildApp({
      ...makeMockDeps({ findFirst: makeFileRow() }),
      getRedis: () => makeRedis({ count: OVER_LIMIT })
    });

    const res = await app.request('http://localhost/share/Abc123defghijkl012/download', {
      method: 'GET',
      headers: { 'x-forwarded-for': '10.0.0.1' }
    });

    expect(res.status).toBe(429);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.RATE_LIMITED);
  });

  test('returns 429 when per-token download rate limit is exceeded', async () => {
    const redis = makeRedis({ counts: [1, OVER_LIMIT] });
    const app = buildApp({
      ...makeMockDeps({ findFirst: makeFileRow() }),
      // First increment (per-IP) passes, second increment (per-token) exceeds limit.
      getRedis: () => redis
    });

    const res = await app.request('http://localhost/share/Abc123defghijkl012/download', {
      method: 'GET',
      headers: { 'x-forwarded-for': '10.0.0.1' }
    });

    expect(res.status).toBe(429);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.RATE_LIMITED);
  });

  test('bypasses rate limiting when no IP header is present', async () => {
    // No x-forwarded-for / x-real-ip header → ipHash is null → rate check is skipped.
    // No Redis double injected — if it were called it would throw.
    const app = buildApp(makeMockDeps({ findFirst: makeFileRow(), updateReturn: [] }));
    const res = await request(app, '/share/Abc123defghijkl012/download');

    // Standard non-one-time file proceeds to presign step.
    // Default signedUrl in makeMockDeps → 200 with a presigned URL.
    expect(res.status).toBe(200);
  });

  test('continues download when rate limiter backend is unavailable', async () => {
    const app = buildApp({
      ...makeMockDeps({ findFirst: makeFileRow() }),
      getRedis: () => makeRedis({ shouldThrow: true })
    });

    const res = await app.request('http://localhost/share/Abc123defghijkl012/download', {
      method: 'GET',
      headers: { 'x-forwarded-for': '10.0.0.1' }
    });

    expect(res.status).toBe(200);
  });
});

describe('GET /share/:token/preview — rate limiting', () => {
  // SHARE_DOWNLOAD_RATE_LIMIT = 30 req/min; a count of 31 exceeds it.
  const OVER_LIMIT = 31;

  test('returns 429 when per-IP preview rate limit is exceeded', async () => {
    const app = buildApp({
      ...makeMockDeps({
        findFirst: makeFileRow({
          allowPreview: true,
          mimeType: 'image/png',
          oneTimeDownload: false
        })
      }),
      getRedis: () => makeRedis({ count: OVER_LIMIT })
    });

    const res = await app.request('http://localhost/share/Abc123defghijkl012/preview', {
      method: 'GET',
      headers: { 'x-forwarded-for': '10.0.0.1' }
    });

    expect(res.status).toBe(429);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.RATE_LIMITED);
  });

  test('returns 429 when per-token preview rate limit is exceeded', async () => {
    const redis = makeRedis({ counts: [1, OVER_LIMIT] });
    const app = buildApp({
      ...makeMockDeps({
        findFirst: makeFileRow({
          allowPreview: true,
          mimeType: 'image/png',
          oneTimeDownload: false
        })
      }),
      // First increment (per-IP) passes, second increment (per-token) exceeds limit.
      getRedis: () => redis
    });

    const res = await app.request('http://localhost/share/Abc123defghijkl012/preview', {
      method: 'GET',
      headers: { 'x-forwarded-for': '10.0.0.1' }
    });

    expect(res.status).toBe(429);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.RATE_LIMITED);
  });

  test('bypasses preview rate limiting when no IP header is present', async () => {
    const app = buildApp(
      makeMockDeps(
        {
          findFirst: makeFileRow({
            allowPreview: true,
            mimeType: 'image/png',
            oneTimeDownload: false
          })
        },
        { signedUrl: 'https://storage.example.com/preview' }
      )
    );

    const res = await request(app, '/share/Abc123defghijkl012/preview');
    expect(res.status).toBe(200);
  });

  test('continues preview when rate limiter backend is unavailable', async () => {
    const app = buildApp({
      ...makeMockDeps(
        {
          findFirst: makeFileRow({
            allowPreview: true,
            mimeType: 'image/png',
            oneTimeDownload: false
          })
        },
        { signedUrl: 'https://storage.example.com/preview' }
      ),
      getRedis: () => makeRedis({ shouldThrow: true })
    });

    const res = await app.request('http://localhost/share/Abc123defghijkl012/preview', {
      method: 'GET',
      headers: { 'x-forwarded-for': '10.0.0.1' }
    });

    expect(res.status).toBe(200);
  });

  test('uses preview-specific per-IP limiter key namespace', async () => {
    const incrKeys: string[] = [];
    const app = buildApp({
      ...makeMockDeps(
        {
          findFirst: makeFileRow({
            allowPreview: true,
            mimeType: 'image/png',
            oneTimeDownload: false
          })
        },
        { signedUrl: 'https://storage.example.com/preview' }
      ),
      getRedis: () =>
        makeRedis({
          onIncr: (key) => {
            incrKeys.push(key);
          }
        })
    });

    const res = await app.request('http://localhost/share/Abc123defghijkl012/preview', {
      method: 'GET',
      headers: { 'x-forwarded-for': '10.0.0.1' }
    });

    expect(res.status).toBe(200);
    expect(incrKeys[0]?.startsWith('rl:preview:')).toBe(true);
    expect(incrKeys.some((key) => key.startsWith('rl:download:'))).toBe(false);
    expect(incrKeys.some((key) => key.startsWith('rl:share_token:'))).toBe(true);
  });
});
