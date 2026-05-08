import { describe, expect, test } from 'bun:test';
import { API_ERROR_CODES } from '@anonshare/contracts';
import {
  buildApp,
  makeFileRow,
  makeMockDeps,
  makeRedis,
  type QueueStubs,
  request
} from './test-helpers';

// ── GET /:token/download — standard download ──────────────────────────────────

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

  test('emits download.started and download.completed with shared request correlation', async () => {
    const app = buildApp(
      makeMockDeps(
        { findFirst: makeFileRow({ oneTimeDownload: false }) },
        { signedUrl: 'https://storage.example.com/dl?token=xyz' }
      )
    );
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
      const res = await request(app, '/share/Abc123defghijkl012/download');
      expect(res.status).toBe(200);
    } finally {
      console.log = originalLog;
    }

    const startedLog = entries.find((entry) => entry.event === 'download.started');
    const completedLog = entries.find((entry) => entry.event === 'download.completed');

    expect(startedLog).toBeDefined();
    expect(completedLog).toBeDefined();
    expect(startedLog?.service).toBe('api');
    expect(completedLog?.service).toBe('api');
    expect(startedLog?.requestId).toBeTruthy();
    expect(completedLog?.requestId).toBe(startedLog?.requestId);
    expect(startedLog?.entity).toEqual({ type: 'file', id: 'Abc123defghijkl012' });
    expect(completedLog?.entity).toEqual({ type: 'file', id: 'Abc123defghijkl012' });
    expect(startedLog?.outcome).toBe('success');
    expect(completedLog?.outcome).toBe('success');
    expect(startedLog?.oneTime).toBe(false);
    expect(completedLog?.source).toBe('presign_issued');
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

  test('still returns presigned URL when download event persistence fails', async () => {
    const app = buildApp(
      makeMockDeps(
        {
          findFirst: makeFileRow({ oneTimeDownload: false }),
          insertShouldThrow: true
        },
        { signedUrl: 'https://storage.example.com/dl?sig=resilient' }
      )
    );
    const res = await request(app, '/share/Abc123defghijkl012/download');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { url: string } };
    expect(body.ok).toBe(true);
    expect(body.data.url).toBe('https://storage.example.com/dl?sig=resilient');
  });

  test('emits structured warning when download event persistence fails', async () => {
    const app = buildApp(
      makeMockDeps(
        {
          findFirst: makeFileRow({ oneTimeDownload: false }),
          insertShouldThrow: true
        },
        { signedUrl: 'https://storage.example.com/dl?sig=logged' }
      )
    );

    const originalLog = console.log;
    const originalWarn = console.warn;
    const entries: Array<Record<string, unknown>> = [];

    const capture = (...args: unknown[]) => {
      const line = args[0];
      if (typeof line !== 'string') return;
      try {
        entries.push(JSON.parse(line) as Record<string, unknown>);
      } catch {}
    };

    console.log = capture;
    console.warn = capture;

    try {
      const res = await request(app, '/share/Abc123defghijkl012/download');
      expect(res.status).toBe(200);

      // Allow time for the non-blocking persistence to settle
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
    }

    const failLog = entries.find((e) => e.event === 'download_event_write_failed');
    expect(failLog).toBeDefined();
    expect(failLog?.outcome).toBe('failure');
    expect(failLog?.entity).toEqual({ type: 'file', id: 'Abc123defghijkl012' });
    expect(failLog?.error).toBeTruthy();
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

// ── GET /:token/download — one-time consumption ───────────────────────────────

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

// ── Cache-Control — download routes ──────────────────────────────────────────

describe('Cache-Control headers — download', () => {
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
});

// ── Rate limiting — download ──────────────────────────────────────────────────

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
