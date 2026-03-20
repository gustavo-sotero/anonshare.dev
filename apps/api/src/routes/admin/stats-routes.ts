import type { Hono } from 'hono';
import { logger } from '../../logger';
import { getRequestId } from '../support';
import { buildDailySeries, startOfUtcDay } from './helpers';
import { buildQueueHealthSnapshot } from './queue-health';
import { requireAdminSession } from './session';
import type { ResolvedAdminRouterDeps } from './types';
import { ABUSE_METRICS_WINDOW_DAYS } from './types';

export function registerAdminStatsRoutes(router: Hono, resolvedDeps: ResolvedAdminRouterDeps) {
  router.get('/stats', async (c) => {
    const auth = await requireAdminSession(c, resolvedDeps);
    if (!auth.ok) {
      return auth.response;
    }

    try {
      const now = resolvedDeps.now();
      const nowMs = now.getTime();
      const metricsStart = startOfUtcDay(now);
      metricsStart.setUTCDate(metricsStart.getUTCDate() - (ABUSE_METRICS_WINDOW_DAYS - 1));
      const requestId = getRequestId(c);
      const [
        anomalyCounts,
        queueHealth,
        reportStatusCounts,
        reportCountsByDay,
        autoHiddenCountsByDay,
        resolvedReportCountsByDay,
        dismissedReportCountsByDay,
        rateLimitBlockedCountsByDay
      ] = await Promise.all([
        resolvedDeps.listOpenAnomalyCounts(),
        Promise.all(
          resolvedDeps.getQueues().map((queue) => buildQueueHealthSnapshot(queue, nowMs, requestId))
        ),
        resolvedDeps.listReportStatusCounts(),
        resolvedDeps.listReportCountsByDay(metricsStart),
        resolvedDeps.listAutoHiddenCountsByDay(metricsStart),
        resolvedDeps.listResolvedReportCountsByDay(metricsStart),
        resolvedDeps.listDismissedReportCountsByDay(metricsStart),
        resolvedDeps
          .listRateLimitBlockedCountsByDay(metricsStart, ABUSE_METRICS_WINDOW_DAYS)
          .catch((err) => {
            logger.warn('Admin rate-limit metrics degraded', {
              event: 'admin_rate_limit_metrics_degraded',
              requestId,
              actor: 'admin',
              entity: { type: 'http_request', id: c.req.path },
              outcome: 'failure',
              error: err instanceof Error ? err.message : String(err)
            });

            return [];
          })
      ]);

      const openAnomaliesByType = Object.fromEntries(
        anomalyCounts.map((row) => [row.type, row.count])
      );
      const openAnomaliesTotal = anomalyCounts.reduce((sum, row) => sum + row.count, 0);

      const reportTotals = {
        total: 0,
        byStatus: {
          pending: 0,
          resolved: 0,
          dismissed: 0
        }
      };

      for (const row of reportStatusCounts) {
        reportTotals.total += row.count;
        if (row.status === 'pending' || row.status === 'resolved' || row.status === 'dismissed') {
          reportTotals.byStatus[row.status] = row.count;
        }
      }

      const abuseMetrics = {
        windowDays: ABUSE_METRICS_WINDOW_DAYS,
        reportsByDay: buildDailySeries(reportCountsByDay, metricsStart, ABUSE_METRICS_WINDOW_DAYS),
        autoHiddenByDay: buildDailySeries(
          autoHiddenCountsByDay,
          metricsStart,
          ABUSE_METRICS_WINDOW_DAYS
        ),
        resolvedReportsByDay: buildDailySeries(
          resolvedReportCountsByDay,
          metricsStart,
          ABUSE_METRICS_WINDOW_DAYS
        ),
        dismissedReportsByDay: buildDailySeries(
          dismissedReportCountsByDay,
          metricsStart,
          ABUSE_METRICS_WINDOW_DAYS
        ),
        rateLimitBlockedByDay: buildDailySeries(
          rateLimitBlockedCountsByDay,
          metricsStart,
          ABUSE_METRICS_WINDOW_DAYS
        )
      };

      return c.json(
        {
          openAnomaliesTotal,
          openAnomaliesByType,
          reportTotals,
          abuseMetrics,
          queueHealth
        },
        200
      );
    } catch (err) {
      logger.error('Admin lifecycle stats query failed', {
        event: 'admin_lifecycle_stats_query_failed',
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
