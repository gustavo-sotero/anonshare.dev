import type { Hono } from 'hono';
import { logger } from '../../logger';
import { getRequestId } from '../support';
import { clampAnomalyLimit, getAnomalySeverity, normalizeAnomalyDetails } from './helpers';
import { requireAdminSession } from './session';
import type { ResolvedAdminRouterDeps } from './types';

export function registerAdminOverviewRoutes(router: Hono, resolvedDeps: ResolvedAdminRouterDeps) {
  router.get('/overview', async (c) => {
    const auth = await requireAdminSession(c, resolvedDeps);
    if (!auth.ok) return auth.response;

    const requestId = getRequestId(c);

    try {
      const [fileStatusCounts, downloadCounts] = await Promise.all([
        resolvedDeps.listFileStatusCounts(),
        resolvedDeps.getDownloadCounts()
      ]);

      const byStatus: Record<string, number> = {};
      let totalFiles = 0;
      let totalStorageBytes = 0;

      for (const row of fileStatusCounts) {
        byStatus[row.status] = row.count;
        totalFiles += row.count;
        totalStorageBytes += Number(row.totalSizeBytes);
      }

      return c.json(
        {
          totalFiles,
          byStatus,
          totalStorageBytes,
          totalDownloads: downloadCounts.totalDownloads
        },
        200
      );
    } catch (err) {
      logger.error('Admin overview query failed', {
        event: 'admin_overview_query_failed',
        requestId,
        actor: 'admin',
        entity: { type: 'http_request', id: c.req.path },
        outcome: 'failure',
        error: err instanceof Error ? err.message : String(err)
      });
      return c.json({ error: 'internal_error' }, 500);
    }
  });

  router.get('/anomalies', async (c) => {
    const auth = await requireAdminSession(c, resolvedDeps);
    if (!auth.ok) {
      return auth.response;
    }

    try {
      const anomalies = await resolvedDeps.listAnomalies(clampAnomalyLimit(c.req.query('limit')));

      return c.json(
        {
          anomalies: anomalies.map((anomaly) => {
            const details = normalizeAnomalyDetails(anomaly.details);

            return {
              id: anomaly.id,
              type: anomaly.type,
              severity: getAnomalySeverity(anomaly.type, details),
              fileId: anomaly.fileId,
              details,
              detectedAt: anomaly.detectedAt.toISOString(),
              resolvedAt: anomaly.resolvedAt?.toISOString() ?? null,
              resolution: anomaly.resolution
            };
          })
        },
        200
      );
    } catch (err) {
      logger.error('Admin anomalies query failed', {
        event: 'admin_anomalies_query_failed',
        requestId: getRequestId(c),
        actor: 'admin',
        entity: { type: 'http_request', id: c.req.path },
        outcome: 'failure',
        error: err instanceof Error ? err.message : String(err)
      });
      return c.json({ error: 'internal_error' }, 500);
    }
  });
}
