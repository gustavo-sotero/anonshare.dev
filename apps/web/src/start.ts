import { logger } from '@anonshare/infrastructure/logger';
import { createMiddleware, createStart } from '@tanstack/react-start';
import {
  applyWebResponsePolicy,
  logWebRequestCompletion,
  resolveWebActor
} from './server/request-policy';

const requestPolicyMiddleware = createMiddleware().server(async ({ next, request }) => {
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  const startedAt = performance.now();
  const path = new URL(request.url).pathname;

  try {
    const result = await next();

    applyWebResponsePolicy(result.response.headers, path, requestId);
    logWebRequestCompletion({
      durationMs: performance.now() - startedAt,
      method: request.method,
      path,
      requestId,
      statusCode: result.response.status
    });

    return result;
  } catch (error) {
    logger.error('Unhandled web request', {
      event: 'unhandled_error',
      service: 'web',
      requestId,
      actor: resolveWebActor(path),
      entity: { type: 'http_request', id: `${request.method} ${path}` },
      outcome: 'failure',
      error: error instanceof Error ? error.message : String(error)
    });

    throw error;
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [requestPolicyMiddleware]
}));
