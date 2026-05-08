import { describe, expect, test } from 'bun:test';
import { API_ERROR_CODES } from '@anonshare/contracts';
import { buildApp, makeFileRow, makeMockDeps, makeRedis, request } from './test-helpers';

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

// ── Cache-Control — preview routes ────────────────────────────────────────────

describe('Cache-Control headers — preview', () => {
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

// ── Rate limiting — preview ───────────────────────────────────────────────────

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
