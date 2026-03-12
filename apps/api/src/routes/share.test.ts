import { describe, expect, test } from 'bun:test';
import { API_ERROR_CODES } from '@anonshare/contracts';
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

function makeMockDeps(db: DbStubs = {}, storage: StorageStubs = {}): ShareRouterDeps {
  let updateCallCount = 0;

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
    }
  };
}

function buildApp(deps?: ShareRouterDeps): Hono {
  const app = new Hono();
  app.route('/share', createShareRouter(deps));
  return app;
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
    const app = buildApp(
      makeMockDeps(
        {
          findFirst: makeFileRow({ oneTimeDownload: true, status: 'active' }),
          updateReturn: [{ id: 'file-uuid-1', objectKey: 'objects/test-uuid' }]
        },
        { signedUrl: 'https://storage.example.com/one-time-dl' }
      )
    );
    const res = await request(app, '/share/Abc123defghijkl012/download');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { url: string } };
    expect(body.ok).toBe(true);
    expect(body.data.url).toBe('https://storage.example.com/one-time-dl');
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
  test('metadata 200 includes private max-age cache header', async () => {
    const app = buildApp(makeMockDeps({ findFirst: makeFileRow() }));
    const res = await request(app, '/share/Abc123defghijkl012');

    expect(res.status).toBe(200);
    const cc = res.headers.get('cache-control');
    expect(cc).toContain('private');
    expect(cc).toContain('max-age=60');
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
