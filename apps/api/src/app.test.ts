import { describe, expect, test } from 'bun:test';
import { createApiApp } from './app';

describe('API health endpoint', () => {
  test('returns 200 when all dependencies are healthy', async () => {
    const app = createApiApp({
      healthCheck: async () => [
        { dependency: 'postgres', durationMs: 1, ok: true },
        { dependency: 'redis', durationMs: 1, ok: true },
        { dependency: 'storage', durationMs: 1, ok: true }
      ]
    });

    const response = await app.request('http://localhost/health');

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBeTruthy();
    expect(await response.json()).toEqual({
      dependencies: [
        { dependency: 'postgres', durationMs: 1, ok: true },
        { dependency: 'redis', durationMs: 1, ok: true },
        { dependency: 'storage', durationMs: 1, ok: true }
      ],
      service: 'api',
      status: 'ok'
    });
  });

  test('returns 503 when any dependency is degraded', async () => {
    const app = createApiApp({
      healthCheck: async () => [
        { dependency: 'postgres', durationMs: 1, ok: true },
        { dependency: 'redis', durationMs: 1, ok: false, details: 'timeout' },
        { dependency: 'storage', durationMs: 1, ok: true }
      ]
    });

    const response = await app.request('http://localhost/health');

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      dependencies: [
        { dependency: 'postgres', durationMs: 1, ok: true },
        { dependency: 'redis', durationMs: 1, ok: false, details: 'timeout' },
        { dependency: 'storage', durationMs: 1, ok: true }
      ],
      service: 'api',
      status: 'degraded'
    });
  });
});
