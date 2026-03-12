import { describe, expect, test } from 'bun:test';
import { API_ERROR_CODES } from '@anonshare/contracts';
import { Hono } from 'hono';
import { reportRouter } from './report';

function buildApp(): Hono {
  const app = new Hono();
  app.route('/report', reportRouter);
  return app;
}

describe('POST /report/:token', () => {
  test('returns 404 for malformed token', async () => {
    const app = buildApp();
    const res = await app.request('http://localhost/report/bad!', { method: 'POST' });

    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');

    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.NOT_FOUND);
  });

  test('returns 501 placeholder envelope for valid token', async () => {
    const app = buildApp();
    const res = await app.request('http://localhost/report/Abc123defghijkl012', {
      method: 'POST'
    });

    expect(res.status).toBe(501);
    expect(res.headers.get('cache-control')).toBe('no-store');

    const body = (await res.json()) as { ok: boolean; error: { code: string; message: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.INTERNAL_ERROR);
    expect(body.error.message).toContain('not available yet');
  });
});
