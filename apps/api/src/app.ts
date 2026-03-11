import type { DependencyHealthResult } from '@anonshare/infrastructure/health';
import { logger } from '@anonshare/infrastructure/logger';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { adminRouter } from './routes/admin';
import { internalRouter } from './routes/internal';
import { reportRouter } from './routes/report';
import { shareRouter } from './routes/share';
import { uploadRouter } from './routes/upload';

type ApiAppOptions = {
  healthCheck?: () => Promise<DependencyHealthResult[]>;
};

async function defaultHealthCheck(): Promise<DependencyHealthResult[]> {
  const { checkPlatformHealth } = await import('@anonshare/infrastructure/health');
  return checkPlatformHealth();
}

async function summarizeHealth(results: DependencyHealthResult[]) {
  const { evaluatePlatformHealth } = await import('@anonshare/infrastructure/health');
  return evaluatePlatformHealth(results);
}

function resolveActor(path: string): 'admin' | 'anonymous' | 'worker' {
  if (path.startsWith('/admin')) {
    return 'admin';
  }

  if (path.startsWith('/_internal')) {
    return 'worker';
  }

  return 'anonymous';
}

export function createApiApp(options: ApiAppOptions = {}): Hono {
  const healthCheck = options.healthCheck ?? defaultHealthCheck;
  const app = new Hono();

  app.use(secureHeaders());
  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
    c.header('x-request-id', requestId);

    const startedAt = performance.now();

    await next();

    logger.info('HTTP request completed', {
      event: 'http_request_completed',
      requestId,
      actor: resolveActor(c.req.path),
      entity: { type: 'http_request', id: `${c.req.method} ${c.req.path}` },
      outcome: c.res.status >= 400 ? 'failure' : 'success',
      method: c.req.method,
      path: c.req.path,
      statusCode: c.res.status,
      durationMs: Number((performance.now() - startedAt).toFixed(2))
    });
  });

  app.get('/health', async (c) => {
    const results = await healthCheck();
    const summary = await summarizeHealth(results);

    c.header('cache-control', 'no-store');

    return c.json(
      {
        dependencies: summary.results,
        service: 'api',
        status: summary.status
      },
      summary.ok ? 200 : 503
    );
  });

  app.route('/upload', uploadRouter);
  app.route('/share', shareRouter);
  app.route('/report', reportRouter);
  app.route('/admin', adminRouter);
  app.route('/_internal', internalRouter);

  return app;
}
