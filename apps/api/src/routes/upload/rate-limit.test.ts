import { describe, expect, test } from 'bun:test';
import { API_ERROR_CODES } from '@anonshare/contracts';
import {
  buildApp,
  makeFailingRedis,
  makeFile,
  makeMockDeps,
  makeRedis,
  postUpload
} from './test-helpers';

describe('POST /upload — rate limiting', () => {
  const OVER_LIMIT = 21;

  test('returns 429 when per-IP upload rate limit is exceeded', async () => {
    const app = buildApp({
      ...makeMockDeps(),
      getRedis: () => makeRedis({ count: OVER_LIMIT })
    });

    const res = await postUpload(app, { file: makeFile() }, { 'x-forwarded-for': '10.0.0.1' });

    expect(res.status).toBe(429);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.RATE_LIMITED);
  });

  test('uses the configured upload rate limit loader when provided', async () => {
    const app = buildApp({
      ...makeMockDeps(),
      getRedis: () => makeRedis({ count: 6 }),
      loadUploadRateLimit: async () => 5
    });

    const res = await postUpload(app, { file: makeFile() }, { 'x-forwarded-for': '10.0.0.1' });

    expect(res.status).toBe(429);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.RATE_LIMITED);
  });

  test('bypasses rate limiting when no IP header is present', async () => {
    const app = buildApp(makeMockDeps());
    const res = await postUpload(app, { file: makeFile() });

    expect(res.status).toBe(201);
  });

  test('continues upload when Redis rate limiter is unavailable', async () => {
    const app = buildApp({
      ...makeMockDeps(),
      getRedis: () => makeFailingRedis()
    });

    const res = await postUpload(app, { file: makeFile() }, { 'x-forwarded-for': '10.0.0.1' });

    expect(res.status).toBe(201);
  });
});
