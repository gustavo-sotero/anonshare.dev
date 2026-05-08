import { describe, expect, test } from 'bun:test';
import { API_ERROR_CODES } from '@anonshare/contracts';
import { buildApp, makeFileRow, makeMockDeps, makeRedis, request } from './test-helpers';

// ── GET /:token — metadata ────────────────────────────────────────────────────

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

// ── Cache-Control — metadata routes ──────────────────────────────────────────

describe('Cache-Control headers — metadata', () => {
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
});

// ── Security headers ──────────────────────────────────────────────────────────

describe('Share security headers', () => {
  test('sets x-robots-tag: noindex, nofollow on metadata responses', async () => {
    const app = buildApp(makeMockDeps({ findFirst: makeFileRow() }));
    const res = await app.request('http://localhost/share/Abc123defghijkl012');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  test('sets x-robots-tag: noindex, nofollow on download responses', async () => {
    const app = buildApp(
      makeMockDeps({ findFirst: makeFileRow() }, { signedUrl: 'https://storage.example.com/dl' })
    );
    const res = await app.request('http://localhost/share/Abc123defghijkl012/download');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  test('sets x-robots-tag: noindex, nofollow on 404 responses', async () => {
    const app = buildApp(makeMockDeps({ findFirst: null }));
    const res = await app.request('http://localhost/share/Abc123defghijkl012');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });
});
