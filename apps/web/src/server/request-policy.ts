import { logger } from '@anonshare/infrastructure/logger';

export type WebActor = 'admin' | 'anonymous' | 'system';

type WebRequestLog = {
  durationMs: number;
  method: string;
  path: string;
  requestId: string;
  statusCode: number;
};

function buildPermissionsPolicy(): string {
  return 'camera=(), microphone=(), geolocation=(), payment=()';
}

export function resolveWebActor(path: string): WebActor {
  if (path === '/health') {
    return 'system';
  }

  if (path === '/admin' || path.startsWith('/admin/')) {
    return 'admin';
  }

  return 'anonymous';
}

export function applyWebResponsePolicy(headers: Headers, path: string, requestId: string): void {
  headers.set('x-request-id', requestId);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('permissions-policy', buildPermissionsPolicy());
  headers.set('cross-origin-opener-policy', 'same-origin');
  headers.set('cross-origin-resource-policy', 'same-origin');

  if (path === '/health') {
    headers.set('cache-control', 'no-store');
    return;
  }

  if (path === '/admin' || path.startsWith('/admin/')) {
    headers.set('cache-control', 'no-store, private');
    headers.set('x-robots-tag', 'noindex, nofollow');
    return;
  }

  if (path.startsWith('/share/')) {
    headers.set('cache-control', 'no-store');
    headers.set('x-robots-tag', 'noindex, nofollow');
  }
}

export function logWebRequestCompletion({
  durationMs,
  method,
  path,
  requestId,
  statusCode
}: WebRequestLog): void {
  logger.info('HTTP request completed', {
    event: 'http_request_completed',
    service: 'web',
    requestId,
    actor: resolveWebActor(path),
    entity: { type: 'http_request', id: `${method} ${path}` },
    outcome: statusCode >= 400 ? 'failure' : 'success',
    method,
    path,
    statusCode,
    durationMs: Number(durationMs.toFixed(2))
  });
}
