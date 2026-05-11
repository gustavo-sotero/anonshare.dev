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
