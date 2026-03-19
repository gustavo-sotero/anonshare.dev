import { describe, expect, test } from 'bun:test';
import { applyWebResponsePolicy, resolveWebActor } from './request-policy';

describe('web request policy', () => {
  test('applies baseline security headers to every response', () => {
    const headers = new Headers();

    applyWebResponsePolicy(headers, '/', 'request-123');

    expect(headers.get('x-request-id')).toBe('request-123');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('x-frame-options')).toBe('DENY');
    expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('permissions-policy')).toContain('camera=()');
    expect(headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(headers.get('cross-origin-resource-policy')).toBe('same-origin');
  });

  test('marks share pages as no-store and noindex', () => {
    const headers = new Headers();

    applyWebResponsePolicy(headers, '/share/token-123', 'request-123');

    expect(headers.get('cache-control')).toBe('no-store');
    expect(headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  test('marks admin pages as private and noindex', () => {
    const headers = new Headers();

    applyWebResponsePolicy(headers, '/admin', 'request-123');

    expect(headers.get('cache-control')).toBe('no-store, private');
    expect(headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  test('keeps the health route uncached', () => {
    const headers = new Headers();

    applyWebResponsePolicy(headers, '/health', 'request-123');

    expect(headers.get('cache-control')).toBe('no-store');
    expect(headers.get('x-robots-tag')).toBeNull();
  });

  test('resolves the expected actor namespace for request logs', () => {
    expect(resolveWebActor('/')).toBe('anonymous');
    expect(resolveWebActor('/share/token-123')).toBe('anonymous');
    expect(resolveWebActor('/admin')).toBe('admin');
    expect(resolveWebActor('/health')).toBe('system');
  });
});
