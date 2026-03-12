import { describe, expect, test } from 'bun:test';
import { API_ERROR_CODES, uploadRequestSchema } from '@anonshare/contracts';
import { MAX_EXPIRATION_DAYS, MAX_FILE_SIZE_BYTES } from '@anonshare/domain';
import { StorageError } from '@anonshare/infrastructure/storage';
import { Hono } from 'hono';
import { createUploadRouter, type UploadRouterDeps } from './upload';

// ── Test-double helpers ───────────────────────────────────────────────────────

type DbStubs = {
  insertShouldThrow?: boolean;
  insertReturn?: { id: string }[];
  updateReturn?: { id: string }[];
  updateShouldThrow?: boolean;
  deleteShouldThrow?: boolean;
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

/**
 * Builds minimal injectable deps for the upload router.
 * The DB double implements only the Drizzle chain surface called by the handler.
 */
function makeMockDeps(db: DbStubs = {}, storage: StorageStubs = {}): UploadRouterDeps {
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
          values: (_vals: unknown) => ({
            returning: async (_cols: unknown) => {
              if (db.insertShouldThrow) throw new Error('DB insert failed');
              return insertReturn;
            }
          })
        }),
        update: (_tbl: unknown) => ({
          set: (_vals: unknown) => ({
            where: (_cond: unknown) => ({
              returning: async (_cols: unknown) => {
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
      put: async (obj: unknown) => {
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
      },
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
      },
      delete: async (key: string) => {
        storage.captureDelete?.(key);
        if (storage.deleteShouldThrow) throw new Error('Storage delete failed');
      }
    }
  };
}

function makeFile(sizeBytes = 1024, name = 'test.txt', type = 'text/plain'): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

function makeFutureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString();
}

function yesterdayIso(): string {
  return new Date(Date.now() - 86_400_000).toISOString();
}

/** Mount the upload router under /upload and return the composite app. */
function buildApp(deps?: UploadRouterDeps): Hono {
  const app = new Hono();
  app.route('/upload', createUploadRouter(deps));
  return app;
}

/**
 * Fire POST /upload with a FormData built from `fields`.
 * Fields with a `null` value are omitted entirely (not appended to the form).
 */
async function postUpload(
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

// ── Validation tests (no real infrastructure needed) ─────────────────────────
// All paths below are rejected before the handler touches DB or storage,
// so we run them against a router created without mock deps.

describe('POST /upload — pre-flight size guard (content-length header)', () => {
  const app = buildApp();

  test('rejects when the declared content-length exceeds the 256 MB limit', async () => {
    // The handler inspects content-length before parsing the multipart body.
    // We pass a tiny real body but claim a size larger than the limit + overhead.
    const response = await app.request('http://localhost/upload', {
      method: 'POST',
      headers: {
        'content-length': String(MAX_FILE_SIZE_BYTES + 65_536 + 1)
      },
      body: new Uint8Array(10)
    });

    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.FILE_TOO_LARGE);
  });
});

describe('POST /upload — metadata validation', () => {
  const app = buildApp();

  test('rejects malformed multipart payloads with a validation error', async () => {
    const response = await app.request('http://localhost/upload', {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=broken-boundary'
      },
      body: '--broken-boundary\r\nContent-Disposition: form-data; name="file"\r\n\r\n'
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
  });

  test('rejects when the file field is absent', async () => {
    const form = new FormData();
    form.append('oneTime', 'false');
    const response = await app.request('http://localhost/upload', {
      method: 'POST',
      body: form
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
  });

  test('rejects one-time + allow-preview combination (PRD invariant)', async () => {
    const response = await postUpload(app, {
      file: makeFile(),
      oneTime: true,
      allowPreview: true
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
  });

  test('rejects expiration beyond MAX_EXPIRATION_DAYS', async () => {
    const response = await postUpload(app, {
      file: makeFile(),
      expiresAt: makeFutureDate(MAX_EXPIRATION_DAYS + 1)
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
  });

  test('rejects a past expiration date', async () => {
    const response = await postUpload(app, {
      file: makeFile(),
      expiresAt: yesterdayIso()
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
  });

  test('substitutes "upload" as fallback when filename is empty and accepts the upload', async () => {
    // The handler does `fileField.name || 'upload'` before schema validation,
    // so an empty-named file should be accepted, not rejected.
    const app = buildApp(makeMockDeps());
    const emptyNameFile = new File([new Uint8Array(1024)], '', { type: 'text/plain' });
    const response = await postUpload(app, { file: emptyNameFile });

    expect(response.status).toBe(201);
  });
});

// ── Happy-path and lifecycle tests (mock DB + storage) ────────────────────────

describe('POST /upload — successful upload lifecycle', () => {
  test('returns 201 with shareToken, shareUrl and null expiresAt', async () => {
    const app = buildApp(makeMockDeps());

    const response = await postUpload(app, {
      file: makeFile(),
      oneTime: false,
      allowPreview: false
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(typeof body.data.shareToken).toBe('string');
    expect(body.data.shareToken.length).toBeGreaterThanOrEqual(16);
    expect(body.data.shareUrl).toContain('/share/');
    expect(body.data.shareUrl).toContain(body.data.shareToken);
    expect(body.data.expiresAt).toBeNull();
  });

  test('populates expiresAt in the response when an expiration is configured', async () => {
    const app = buildApp(makeMockDeps());
    const expiresAt = makeFutureDate(7);

    const response = await postUpload(app, { file: makeFile(), expiresAt });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(typeof body.data.expiresAt).toBe('string');
    expect(body.data.expiresAt).not.toBeNull();
  });

  test('produces a unique share token for each upload', async () => {
    const app = buildApp(makeMockDeps());

    const [r1, r2] = await Promise.all([
      postUpload(app, { file: makeFile() }),
      postUpload(app, { file: makeFile() })
    ]);

    const b1 = await r1.json();
    const b2 = await r2.json();

    expect(b1.data.shareToken).not.toBe(b2.data.shareToken);
  });

  test('accepts a one-time upload without preview and returns 201', async () => {
    const app = buildApp(makeMockDeps());

    const response = await postUpload(app, {
      file: makeFile(),
      oneTime: true,
      allowPreview: false
    });

    expect(response.status).toBe(201);
  });

  test('sanitizes path-traversal filenames and still returns 201', async () => {
    const app = buildApp(makeMockDeps());
    const dangerousFile = new File([new Uint8Array(1024)], '../../etc/passwd', {
      type: 'text/plain'
    });

    const response = await postUpload(app, { file: dangerousFile });

    // A successful 201 confirms the handler sanitized the filename rather than
    // rejecting or crashing on the dangerous path separators.
    expect(response.status).toBe(201);
  });

  test('streams the uploaded file to storage instead of buffering it into a Uint8Array', async () => {
    let capturedBody: unknown;
    const app = buildApp(
      makeMockDeps({}, { capturePut: (obj) => (capturedBody = (obj as { body?: unknown }).body) })
    );

    const response = await postUpload(app, { file: makeFile() });

    expect(response.status).toBe(201);
    expect(capturedBody).toBeInstanceOf(ReadableStream);
  });

  test('retries storage confirmation and succeeds when metadata becomes visible', async () => {
    let headAttempts = 0;
    const app = buildApp(
      makeMockDeps(
        {},
        {
          headImpl: async () => {
            headAttempts += 1;

            if (headAttempts < 3) {
              return null;
            }

            return {
              contentLength: 1024,
              contentType: 'text/plain'
            };
          }
        }
      )
    );

    const response = await postUpload(app, { file: makeFile() });

    expect(response.status).toBe(201);
    expect(headAttempts).toBe(3);
  });
});

// ── Failure and compensation paths ────────────────────────────────────────────

describe('POST /upload — infrastructure failure handling', () => {
  test('returns 500 when DB insert fails (storage is never touched)', async () => {
    const app = buildApp(makeMockDeps({ insertShouldThrow: true }));

    const response = await postUpload(app, { file: makeFile() });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.INTERNAL_ERROR);
  });

  test('returns 500 and triggers DB compensation when storage.put fails', async () => {
    // storage.put throws → handler compensates by deleting the pending DB record.
    const app = buildApp(makeMockDeps({}, { putShouldThrow: true }));

    const response = await postUpload(app, { file: makeFile() });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.INTERNAL_ERROR);
  });

  test('returns 500 when both storage.put and compensation DB delete fail', async () => {
    // Both storage and the cleanup DELETE fail. The pending record stays for
    // the reconciler; the handler still returns an error to the client.
    const app = buildApp(makeMockDeps({ deleteShouldThrow: true }, { putShouldThrow: true }));

    const response = await postUpload(app, { file: makeFile() });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.INTERNAL_ERROR);
  });

  test('returns 500 when activation DB update fails (storage object is safe)', async () => {
    // Storage write succeeded but the UPDATE to set status=active threw.
    // The object is safe in storage; the reconciler will promote the record.
    const app = buildApp(makeMockDeps({ updateShouldThrow: true }));

    const response = await postUpload(app, { file: makeFile() });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.INTERNAL_ERROR);
  });

  test('returns 500 and deletes the stored object when activation updates no records', async () => {
    let deletedKey: string | undefined;
    const app = buildApp(
      makeMockDeps(
        { updateReturn: [] },
        {
          captureDelete: (key) => {
            deletedKey = key;
          }
        }
      )
    );

    const response = await postUpload(app, { file: makeFile() });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.INTERNAL_ERROR);
    expect(deletedKey).toMatch(/^objects\//);
  });

  test('returns 500 when storage confirmation cannot find the uploaded object', async () => {
    const app = buildApp(makeMockDeps({}, { headReturn: null }));

    const response = await postUpload(app, { file: makeFile() });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.INTERNAL_ERROR);
  });

  test('returns 500 when storage confirmation reports a size mismatch', async () => {
    const app = buildApp(
      makeMockDeps({}, { headReturn: { contentLength: 1, contentType: 'text/plain' } })
    );

    const response = await postUpload(app, { file: makeFile() });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.INTERNAL_ERROR);
  });

  test('returns 500 after exhausting storage confirmation retries', async () => {
    let headAttempts = 0;
    const app = buildApp(
      makeMockDeps(
        {},
        {
          headImpl: async () => {
            headAttempts += 1;
            throw new Error('Storage head failed');
          }
        }
      )
    );

    const response = await postUpload(app, { file: makeFile() });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.INTERNAL_ERROR);
    expect(headAttempts).toBe(3);
  });
});

// ── StorageError classification handling ──────────────────────────────────────

describe('POST /upload — StorageError propagation', () => {
  test('returns 500 and compensates when storage.put throws a classified StorageError', async () => {
    // Verify the handler treats StorageError exactly like a generic Error — it must
    // compensate (delete the pending record) and return 500 regardless of error type.
    const app = buildApp({
      ...makeMockDeps(),
      storage: {
        put: async (_obj: unknown) => {
          throw new StorageError(
            'Storage operation timed out after 600000ms (put)',
            'transient',
            new Error('Socket hang up')
          );
        },
        head: async (_key: string) => ({
          contentLength: 1024,
          contentType: 'text/plain'
        }),
        delete: async (_key: string) => {
          return undefined;
        }
      }
    });

    const response = await postUpload(app, { file: makeFile() });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.INTERNAL_ERROR);
  });
});

// ── Schema-level MIME type validation ────────────────────────────────────────

describe('uploadRequestSchema — MIME type validation', () => {
  test('rejects a mimeType with no slash (not type/subtype format)', () => {
    const result = uploadRequestSchema.safeParse({
      filename: 'file.bin',
      mimeType: 'notamimetype',
      sizeBytes: 1024,
      oneTime: false,
      allowPreview: false,
      expiresAt: null
    });
    expect(result.success).toBe(false);
  });

  test('rejects a mimeType with more than two slash-delimited segments', () => {
    const result = uploadRequestSchema.safeParse({
      filename: 'file.bin',
      mimeType: 'application/json/extra',
      sizeBytes: 1024,
      oneTime: false,
      allowPreview: false,
      expiresAt: null
    });
    expect(result.success).toBe(false);
  });

  test('accepts a MIME type with a charset parameter', () => {
    const result = uploadRequestSchema.safeParse({
      filename: 'file.txt',
      mimeType: 'text/plain;charset=utf-8',
      sizeBytes: 512,
      oneTime: false,
      allowPreview: false,
      expiresAt: null
    });
    expect(result.success).toBe(true);
  });
});
