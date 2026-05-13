import { describe, expect, test } from 'bun:test';
import { createApiApp } from './app';

const healthyDeps = async () => [
  { dependency: 'postgres' as const, durationMs: 1, ok: true },
  { dependency: 'redis' as const, durationMs: 1, ok: true },
  { dependency: 'storage' as const, durationMs: 1, ok: true }
];

describe('API health endpoint', () => {
  test('returns 200 when all dependencies are healthy', async () => {
    const app = createApiApp({ healthCheck: healthyDeps });

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

  test('emits a structured health_check_completed log', async () => {
    const app = createApiApp({ healthCheck: healthyDeps });
    const originalLog = console.log;
    const logLines: string[] = [];

    console.log = (...args: unknown[]) => {
      logLines.push(args.map(String).join(' '));
    };

    try {
      const response = await app.request('http://localhost/health');
      expect(response.status).toBe(200);
    } finally {
      console.log = originalLog;
    }

    const healthLog = logLines
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .find((entry) => entry?.event === 'health_check_completed');

    expect(healthLog).toBeDefined();
    expect(healthLog?.service).toBe('api');
    expect(healthLog?.status).toBe('ok');
    expect(healthLog?.dependencyCount).toBe(3);
  });
});

describe('/api prefix routing', () => {
  test('health endpoint is reachable at /api/health (proxy path)', async () => {
    const app = createApiApp({ healthCheck: healthyDeps });
    const res = await app.request('http://localhost/api/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  test('health endpoint remains reachable at /health (internal/Docker path)', async () => {
    const app = createApiApp({ healthCheck: healthyDeps });
    const res = await app.request('http://localhost/health');
    expect(res.status).toBe(200);
  });
});

describe('Security headers', () => {
  test('sets x-content-type-options on every response', async () => {
    const app = createApiApp({ healthCheck: healthyDeps });
    const res = await app.request('http://localhost/health');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  test('sets referrer-policy on every response', async () => {
    const app = createApiApp({ healthCheck: healthyDeps });
    const res = await app.request('http://localhost/health');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });

  test('sets permissions-policy on every response', async () => {
    const app = createApiApp({ healthCheck: healthyDeps });
    const res = await app.request('http://localhost/health');
    const pp = res.headers.get('permissions-policy');
    expect(pp).toBeTruthy();
    expect(pp).toContain('camera=()');
    expect(pp).toContain('microphone=()');
  });
});

describe('Global error handler', () => {
  test('returns 500 with generic message when handler throws', async () => {
    const app = createApiApp({ healthCheck: healthyDeps });
    // Mount a test-only route that throws
    app.get('/test-throw', () => {
      throw new Error('sensitive internal detail');
    });

    const res = await app.request('http://localhost/test-throw');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok: boolean; error: { code: string; message: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Internal server error');
    // Verify the sensitive message is NOT in the response body
    expect(JSON.stringify(body)).not.toContain('sensitive internal detail');
  });
});
