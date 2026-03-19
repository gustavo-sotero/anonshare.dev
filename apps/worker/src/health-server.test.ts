import { describe, expect, test } from 'bun:test';
import { buildWorkerHealthHeaders, createWorkerHealthResponse } from './health-server';

describe('worker health server', () => {
  test('builds uncached security headers for readiness responses', () => {
    const headers = new Headers(buildWorkerHealthHeaders('request-123'));

    expect(headers.get('cache-control')).toBe('no-store');
    expect(headers.get('permissions-policy')).toContain('camera=()');
    expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('x-frame-options')).toBe('DENY');
    expect(headers.get('x-request-id')).toBe('request-123');
  });

  test('reports starting before the worker becomes ready', () => {
    const result = createWorkerHealthResponse({
      dependencies: [
        { dependency: 'postgres', durationMs: 1, ok: true },
        { dependency: 'redis', durationMs: 1, ok: true },
        { dependency: 'storage', durationMs: 1, ok: true }
      ],
      now: new Date('2026-03-18T12:00:00.000Z'),
      state: {
        queueNames: ['expire-file', 'cleanup-file', 'reconcile'],
        ready: false,
        shuttingDown: false
      }
    });

    expect(result.statusCode).toBe(503);
    expect(result.body.status).toBe('starting');
    expect(result.body.ready).toBe(false);
  });

  test('reports ok when the worker is ready and dependencies are healthy', () => {
    const result = createWorkerHealthResponse({
      dependencies: [
        { dependency: 'postgres', durationMs: 1, ok: true },
        { dependency: 'redis', durationMs: 1, ok: true },
        { dependency: 'storage', durationMs: 1, ok: true }
      ],
      now: new Date('2026-03-18T12:00:00.000Z'),
      state: {
        queueNames: ['expire-file', 'cleanup-file', 'reconcile'],
        ready: true,
        shuttingDown: false
      }
    });

    expect(result.statusCode).toBe(200);
    expect(result.body.status).toBe('ok');
    expect(result.body.queueNames).toEqual(['expire-file', 'cleanup-file', 'reconcile']);
    expect(result.body.service).toBe('worker');
  });

  test('reports degraded when dependencies are unavailable', () => {
    const result = createWorkerHealthResponse({
      dependencies: [
        { dependency: 'postgres', durationMs: 1, ok: true },
        { dependency: 'redis', durationMs: 1, ok: false, details: 'timeout' },
        { dependency: 'storage', durationMs: 1, ok: true }
      ],
      now: new Date('2026-03-18T12:00:00.000Z'),
      state: {
        queueNames: ['expire-file', 'cleanup-file', 'reconcile'],
        ready: true,
        shuttingDown: false
      }
    });

    expect(result.statusCode).toBe(503);
    expect(result.body.status).toBe('degraded');
  });

  test('reports shutting down when shutdown starts', () => {
    const result = createWorkerHealthResponse({
      dependencies: [
        { dependency: 'postgres', durationMs: 1, ok: true },
        { dependency: 'redis', durationMs: 1, ok: true },
        { dependency: 'storage', durationMs: 1, ok: true }
      ],
      now: new Date('2026-03-18T12:00:00.000Z'),
      state: {
        queueNames: ['expire-file', 'cleanup-file', 'reconcile'],
        ready: false,
        shuttingDown: true
      }
    });

    expect(result.statusCode).toBe(503);
    expect(result.body.status).toBe('shutting_down');
  });
});
