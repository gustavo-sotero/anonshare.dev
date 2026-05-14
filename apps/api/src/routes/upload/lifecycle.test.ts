import { describe, expect, test } from 'bun:test';
import { MAX_EXPIRATION_DAYS } from '@anonshare/domain';
import { buildApp, makeFile, makeMockDeps, postUpload } from './test-helpers';

describe('POST /upload — successful upload lifecycle', () => {
  test('returns 201 with shareToken, shareUrl and a default 30-day expiresAt', async () => {
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
    expect(typeof body.data.expiresAt).toBe('string');
    const defaultExpiry = new Date(body.data.expiresAt as string);
    const thirtyDaysMs = MAX_EXPIRATION_DAYS * 24 * 60 * 60 * 1000;
    expect(defaultExpiry.getTime()).toBeGreaterThan(Date.now() + thirtyDaysMs - 5_000);
    expect(defaultExpiry.getTime()).toBeLessThanOrEqual(Date.now() + thirtyDaysMs);
  });

  test('enqueues expire-file after activation when expiration falls back to the default 30-day limit', async () => {
    const captured: Array<{ fileId: string; delayMs: number }> = [];
    const app = buildApp(
      makeMockDeps(
        {},
        {},
        {
          captureExpireEnqueue: (fileId, delayMs) => {
            captured.push({ fileId, delayMs });
          }
        }
      )
    );

    const response = await postUpload(app, {
      file: makeFile(),
      oneTime: false,
      allowPreview: false
    });

    expect(response.status).toBe(201);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.fileId).toBe('test-file-id');

    const thirtyDaysMs = MAX_EXPIRATION_DAYS * 24 * 60 * 60 * 1000;
    expect(captured[0]?.delayMs).toBeGreaterThan(thirtyDaysMs - 5_000);
    expect(captured[0]?.delayMs).toBeLessThanOrEqual(thirtyDaysMs);
  });

  test('populates expiresAt in the response when an expiration is configured', async () => {
    const app = buildApp(makeMockDeps());
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const response = await postUpload(app, { file: makeFile(), expiresAt });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(typeof body.data.expiresAt).toBe('string');
    expect(body.data.expiresAt).not.toBeNull();
  });

  test('enqueues expire-file after activation when expiresAt is in the future', async () => {
    const captured: Array<{ fileId: string; delayMs: number }> = [];
    const app = buildApp(
      makeMockDeps(
        {},
        {},
        {
          captureExpireEnqueue: (fileId, delayMs) => {
            captured.push({ fileId, delayMs });
          }
        }
      )
    );
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const response = await postUpload(app, { file: makeFile(), expiresAt });

    expect(response.status).toBe(201);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.fileId).toBe('test-file-id');
    expect(captured[0]?.delayMs).toBeGreaterThan(29 * 60 * 1000);
    expect(captured[0]?.delayMs).toBeLessThanOrEqual(30 * 60 * 1000);
  });

  test('still returns 201 when expire-file enqueue fails after activation', async () => {
    const app = buildApp(makeMockDeps({}, {}, { enqueueExpireShouldThrow: true }));
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const response = await postUpload(app, { file: makeFile(), expiresAt });

    expect(response.status).toBe(201);
  });

  test('emits upload.created with request correlation and api service context', async () => {
    const app = buildApp(makeMockDeps());
    const originalLog = console.log;
    const entries: Array<Record<string, unknown>> = [];

    console.log = (...args: unknown[]) => {
      const line = args[0];

      if (typeof line !== 'string') {
        return;
      }

      try {
        entries.push(JSON.parse(line) as Record<string, unknown>);
      } catch {}
    };

    try {
      const response = await postUpload(app, {
        file: makeFile(),
        oneTime: false,
        allowPreview: false,
        expiresAt: null
      });

      expect(response.status).toBe(201);
    } finally {
      console.log = originalLog;
    }

    const uploadLog = entries.find((entry) => entry.event === 'upload.created');

    expect(uploadLog).toBeDefined();
    expect(uploadLog?.service).toBe('api');
    expect(uploadLog?.requestId).toBeTruthy();
  });

  test('promotes directly to expired and enqueues cleanup when expiration elapses during activation', async () => {
    const capturedUpdates: unknown[] = [];
    const capturedExpireEnqueues: Array<{ fileId: string; delayMs: number }> = [];
    const capturedCleanupEnqueues: Array<{
      fileId: string;
      objectKey: string;
      delayMs: number | undefined;
    }> = [];
    const app = buildApp(
      makeMockDeps(
        {
          captureUpdateSet: (values) => {
            capturedUpdates.push(values);
          }
        },
        {
          headImpl: async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));

            return {
              contentLength: 1024,
              contentType: 'text/plain'
            };
          }
        },
        {
          captureExpireEnqueue: (fileId, delayMs) => {
            capturedExpireEnqueues.push({ fileId, delayMs });
          },
          captureCleanupEnqueue: (fileId, objectKey, delayMs) => {
            capturedCleanupEnqueues.push({ fileId, objectKey, delayMs });
          }
        }
      )
    );
    const expiresAt = new Date(Date.now() + 5).toISOString();

    const response = await postUpload(app, { file: makeFile(), expiresAt });

    expect(response.status).toBe(201);
    expect(capturedUpdates).toContainEqual({
      status: 'expired',
      activatedAt: expect.any(Date)
    });
    expect(capturedExpireEnqueues).toHaveLength(0);
    expect(capturedCleanupEnqueues).toEqual([
      {
        fileId: 'test-file-id',
        objectKey: expect.stringMatching(/^objects\//),
        delayMs: undefined
      }
    ]);
  });

  test('still returns 201 when cleanup enqueue fails for an already-expired activation', async () => {
    const app = buildApp(
      makeMockDeps(
        {},
        {
          headImpl: async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));

            return {
              contentLength: 1024,
              contentType: 'text/plain'
            };
          }
        },
        { enqueueCleanupShouldThrow: true }
      )
    );
    const expiresAt = new Date(Date.now() + 5).toISOString();

    const response = await postUpload(app, { file: makeFile(), expiresAt });

    expect(response.status).toBe(201);
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

    expect(response.status).toBe(201);
  });

  test('buffers small uploads so transient storage writes can be retried', async () => {
    let capturedBody: unknown;
    const app = buildApp(
      makeMockDeps({}, { capturePut: (obj) => (capturedBody = (obj as { body?: unknown }).body) })
    );

    const response = await postUpload(app, { file: makeFile() });

    expect(response.status).toBe(201);
    expect(capturedBody).toBeInstanceOf(Uint8Array);
  });

  test('streams large uploads to storage instead of buffering them in memory', async () => {
    let capturedBody: unknown;
    const app = buildApp(
      makeMockDeps({}, { capturePut: (obj) => (capturedBody = (obj as { body?: unknown }).body) })
    );

    const response = await postUpload(app, { file: makeFile(8 * 1024 * 1024 + 1) });

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

  test('passes uploadedAt explicitly so expiresAt and uploaded_at share the same clock origin', async () => {
    // Regression: previously uploaded_at was left to DB DEFAULT now() while
    // expiresAt was computed from the app clock. If the DB clock trailed by
    // even a millisecond the files_expires_at_window_chk constraint would fire.
    // Fix: both values must originate from the same capturedAt Date instance.
    let capturedInsert: Record<string, unknown> | undefined;
    const app = buildApp(
      makeMockDeps({ captureInsertValues: (v) => (capturedInsert = v as Record<string, unknown>) })
    );

    const response = await postUpload(app, {
      file: makeFile(),
      oneTime: false,
      allowPreview: false
    });

    expect(response.status).toBe(201);
    expect(capturedInsert).toBeDefined();

    const insertedUploadedAt = capturedInsert?.uploadedAt;
    const insertedExpiresAt = capturedInsert?.expiresAt;

    // uploadedAt must be an explicit Date — not left to the DB default
    expect(insertedUploadedAt).toBeInstanceOf(Date);
    // expiresAt must also be a Date
    expect(insertedExpiresAt).toBeInstanceOf(Date);

    const thirtyDaysMs = MAX_EXPIRATION_DAYS * 24 * 60 * 60 * 1000;
    const diff = (insertedExpiresAt as Date).getTime() - (insertedUploadedAt as Date).getTime();

    // Difference must equal exactly 30 days — any deviation means they came
    // from different clock reads and would risk violating the DB constraint.
    expect(diff).toBe(thirtyDaysMs);
  });

  test('expiresAt and uploadedAt use the same origin when caller provides explicit expiresAt', async () => {
    let capturedInsert: Record<string, unknown> | undefined;
    const app = buildApp(
      makeMockDeps({ captureInsertValues: (v) => (capturedInsert = v as Record<string, unknown>) })
    );
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + sevenDaysMs).toISOString();

    await postUpload(app, { file: makeFile(), expiresAt });

    const insertedUploadedAt = capturedInsert?.uploadedAt;
    const insertedExpiresAt = capturedInsert?.expiresAt;

    expect(insertedUploadedAt).toBeInstanceOf(Date);
    expect(insertedExpiresAt).toBeInstanceOf(Date);

    // expiresAt must be >= uploadedAt (DB constraint); with an explicit 7-day
    // value there should be ~7 days between them.
    const diff = (insertedExpiresAt as Date).getTime() - (insertedUploadedAt as Date).getTime();

    expect(diff).toBeGreaterThan(sevenDaysMs - 5_000);
    expect(diff).toBeLessThanOrEqual(sevenDaysMs);
  });
});
