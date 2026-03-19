import type { DependencyHealthResult } from '@anonshare/infrastructure/health';
import { checkPlatformHealth, evaluatePlatformHealth } from '@anonshare/infrastructure/health';
import { logger } from './logger';

export type WorkerHealthStatus = 'degraded' | 'ok' | 'shutting_down' | 'starting';

export type WorkerRuntimeHealthState = {
  queueNames: string[];
  ready: boolean;
  shuttingDown: boolean;
};

type WorkerHealthBody = {
  dependencies: DependencyHealthResult[];
  queueNames: string[];
  ready: boolean;
  service: 'worker';
  shuttingDown: boolean;
  status: WorkerHealthStatus;
  timestamp: string;
};

type WorkerHealthResponse = {
  body: WorkerHealthBody;
  statusCode: number;
};

type WorkerHealthServerOptions = {
  checkDependencies?: () => Promise<DependencyHealthResult[]>;
  getState: () => WorkerRuntimeHealthState;
  now?: () => Date;
  port: number;
};

export function buildWorkerHealthHeaders(requestId: string): HeadersInit {
  return {
    'cache-control': 'no-store',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'x-request-id': requestId
  };
}

export function createWorkerHealthResponse({
  dependencies,
  now,
  state
}: {
  dependencies: DependencyHealthResult[];
  now: Date;
  state: WorkerRuntimeHealthState;
}): WorkerHealthResponse {
  const summary = evaluatePlatformHealth(dependencies);

  let status: WorkerHealthStatus;
  let statusCode: number;

  if (state.shuttingDown) {
    status = 'shutting_down';
    statusCode = 503;
  } else if (!state.ready) {
    status = 'starting';
    statusCode = 503;
  } else if (summary.ok) {
    status = 'ok';
    statusCode = 200;
  } else {
    status = 'degraded';
    statusCode = 503;
  }

  return {
    body: {
      dependencies,
      queueNames: state.queueNames,
      ready: state.ready,
      service: 'worker',
      shuttingDown: state.shuttingDown,
      status,
      timestamp: now.toISOString()
    },
    statusCode
  };
}

export function startWorkerHealthServer({
  checkDependencies = checkPlatformHealth,
  getState,
  now = () => new Date(),
  port
}: WorkerHealthServerOptions) {
  return Bun.serve({
    port,
    async fetch(request) {
      const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
      const url = new URL(request.url);

      if (url.pathname !== '/health') {
        return new Response('Not found', {
          headers: buildWorkerHealthHeaders(requestId),
          status: 404
        });
      }

      const dependencies = await checkDependencies();
      const result = createWorkerHealthResponse({
        dependencies,
        now: now(),
        state: getState()
      });

      logger.info('Health check completed', {
        event: 'health_check_completed',
        requestId,
        actor: 'system',
        entity: { type: 'health_check', id: 'worker' },
        outcome: result.statusCode === 200 ? 'success' : 'failure',
        status: result.body.status,
        dependencyCount: dependencies.length,
        degradedDependencies: dependencies
          .filter((dependency) => !dependency.ok)
          .map((dependency) => dependency.dependency),
        ready: result.body.ready,
        shuttingDown: result.body.shuttingDown
      });

      return Response.json(result.body, {
        headers: buildWorkerHealthHeaders(requestId),
        status: result.statusCode
      });
    }
  });
}
