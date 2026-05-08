import { loadSystemSettingOrDefault } from '@anonshare/infrastructure/config';
import { getRedisClient } from '@anonshare/infrastructure/redis';
import { storageAdapter } from '@anonshare/infrastructure/storage';
import { Hono } from 'hono';
import { enqueueCleanupFileJob } from '../../queues';
import { getDb as sharedGetDb } from '../support';
import { registerShareDownloadRoutes } from './download-routes';
import { registerShareMetaRoutes } from './meta-routes';
import { registerSharePreviewRoutes } from './preview-routes';
import type { ResolvedShareDeps, ShareRouterDeps } from './types';

export function createShareRouter(deps: ShareRouterDeps = {}): Hono {
  const db = deps.getDb ?? sharedGetDb;
  const resolvedDeps: ResolvedShareDeps = {
    db,
    storage: deps.storage ?? storageAdapter,
    enqueueCleanupFile: deps.enqueueCleanupFile ?? enqueueCleanupFileJob,
    redis: deps.getRedis ?? getRedisClient,
    loadDownloadRateLimit:
      deps.loadDownloadRateLimit ??
      (() => loadSystemSettingOrDefault(db(), 'downloadRateLimitPerMinute'))
  };

  const router = new Hono();

  // Security: prevent search engine indexing of share endpoints.
  router.use('*', async (c, next) => {
    c.header('x-robots-tag', 'noindex, nofollow');
    await next();
  });

  registerShareMetaRoutes(router, resolvedDeps);
  registerShareDownloadRoutes(router, resolvedDeps);
  registerSharePreviewRoutes(router, resolvedDeps);

  return router;
}

export type { ShareRouterDeps } from './types';
export const shareRouter = createShareRouter();
