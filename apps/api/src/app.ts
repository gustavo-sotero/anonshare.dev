import type { DependencyHealthResult } from '@anonshare/infrastructure/health';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { logger } from './logger';
import { adminRouter } from './routes/admin';
import { authRouter } from './routes/auth';
import { internalRouter } from './routes/internal';
import { reportRouter } from './routes/report';
import { shareRouter } from './routes/share';
import { uploadRouter } from './routes/upload';

type ApiAppOptions = {
  healthCheck?: () => Promise<DependencyHealthResult[]>;
};

type ApiAppBindings = {
  Variables: {
    requestId: string;
  };
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
  // Normalize paths that arrive with the /api proxy prefix intact
  const normalized = path.startsWith('/api/') ? path.slice(4) : path;

  if (normalized.startsWith('/admin')) {
    return 'admin';
  }

  if (normalized.startsWith('/_internal')) {
    return 'worker';
  }

  return 'anonymous';
}

export function createApiApp(options: ApiAppOptions = {}): Hono<ApiAppBindings> {
  const healthCheck = options.healthCheck ?? defaultHealthCheck;
  const app = new Hono<ApiAppBindings>();

  app.use(
    secureHeaders({
      referrerPolicy: 'strict-origin-when-cross-origin',
      permissionsPolicy: {
        camera: [],
        microphone: [],
        geolocation: [],
        payment: []
      }
    })
  );
  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
    c.set('requestId', requestId);
    c.header('x-request-id', requestId);

    const startedAt = performance.now();

    await next();

    logger.info('HTTP request completed', {
      event: 'http_request_completed',
      service: 'api',
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

  // ── Route definitions ─────────────────────────────────────────────────────
  // All routes are collected on a sub-app so they can be mounted at two
  // different path prefixes simultaneously:
  //   /          — used by Docker healthchecks and internal SSR calls
  //   /api       — used by browser requests forwarded by the reverse proxy
  //                (Traefik/Dokploy routes /api → this container but does not
  //                 strip the prefix, so both paths must be handled)
  const routes = new Hono<ApiAppBindings>();

  routes.get('/health', async (c) => {
    const requestId = c.get('requestId');
    const results = await healthCheck();
    const summary = await summarizeHealth(results);

    c.header('cache-control', 'no-store');

    logger.info('Health check completed', {
      event: 'health_check_completed',
      service: 'api',
      requestId,
      actor: 'system',
      entity: { type: 'health_check', id: 'api' },
      outcome: summary.ok ? 'success' : 'failure',
      status: summary.status,
      dependencyCount: summary.results.length,
      degradedDependencies: summary.results
        .filter((result) => !result.ok)
        .map((result) => result.dependency)
    });

    return c.json(
      {
        dependencies: summary.results,
        service: 'api',
        status: summary.status
      },
      summary.ok ? 200 : 503
    );
  });

  routes.route('/upload', uploadRouter);
  routes.route('/share', shareRouter);
  routes.route('/report', reportRouter);
  routes.route('/admin', adminRouter);
  routes.route('/admin/auth', authRouter);
  routes.route('/_internal', internalRouter);

  app.route('/', routes);
  app.route('/api', routes);

  // ── Global error handler — prevent stack traces from leaking to clients ───
  app.onError((err, c) => {
    const requestId = c.get('requestId') ?? c.req.header('x-request-id') ?? 'unknown';
    logger.error('Unhandled error', {
      event: 'unhandled_error',
      requestId,
      actor: resolveActor(c.req.path),
      entity: { type: 'http_request', id: `${c.req.method} ${c.req.path}` },
      outcome: 'failure',
      error: err instanceof Error ? err.message : String(err)
    });
    return c.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      500
    );
  });

  return app;
}
