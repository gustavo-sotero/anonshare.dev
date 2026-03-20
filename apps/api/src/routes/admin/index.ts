import { Hono } from 'hono';
import { resolveAdminRouterDeps } from './deps';
import { registerAdminDownloadRoutes } from './download-routes';
import { registerAdminFileRoutes } from './file-routes';
import { setNoStoreHeaders } from './helpers';
import { registerAdminOverviewRoutes } from './overview-routes';
import { registerAdminReportRoutes } from './report-routes';
import { registerAdminSessionRoutes } from './session-routes';
import { registerAdminStatsRoutes } from './stats-routes';
import type { AdminRouterDeps } from './types';

export function createAdminRouter(deps: AdminRouterDeps = {}): Hono {
  const router = new Hono();
  const resolvedDeps = resolveAdminRouterDeps(deps);

  router.use('*', async (c, next) => {
    setNoStoreHeaders(c);
    await next();
  });

  registerAdminSessionRoutes(router, resolvedDeps);
  registerAdminOverviewRoutes(router, resolvedDeps);
  registerAdminStatsRoutes(router, resolvedDeps);
  registerAdminFileRoutes(router, resolvedDeps);
  registerAdminReportRoutes(router, resolvedDeps);
  registerAdminDownloadRoutes(router, resolvedDeps);

  return router;
}

export type { AdminRouterDeps } from './types';
export const adminRouter = createAdminRouter();
