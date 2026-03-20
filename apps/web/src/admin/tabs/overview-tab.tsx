import { formatBytes, formatCount, formatLag } from '~/admin/formatters';
import type { DashboardData } from '~/admin/transport';

export function OverviewTab({ data }: { data: DashboardData }) {
  const { overview, stats } = data;
  const queueFailures = stats.queueHealth.reduce((sum, q) => sum + q.failed, 0);
  const maxLagMs = stats.queueHealth.reduce((max, q) => Math.max(max, q.lagMs), 0);
  const reportsInWindow = stats.abuseMetrics.reportsByDay.reduce((s, r) => s + r.count, 0);
  const autoHiddenInWindow = stats.abuseMetrics.autoHiddenByDay.reduce((s, r) => s + r.count, 0);
  const rateLimitBlockedInWindow = stats.abuseMetrics.rateLimitBlockedByDay.reduce(
    (s, r) => s + r.count,
    0
  );

  return (
    <>
      <section className="panel panel--feature">
        <p className="panel__label">Platform overview</p>
        <div className="admin-overview-grid">
          <article className="metric-card">
            <p className="surface-card__index">Total files</p>
            <strong className="metric-card__value">{formatCount(overview.totalFiles)}</strong>
          </article>
          <article className="metric-card">
            <p className="surface-card__index">Active</p>
            <strong className="metric-card__value">
              {formatCount((overview.byStatus.active ?? 0) + (overview.byStatus.expiring ?? 0))}
            </strong>
          </article>
          <article className="metric-card">
            <p className="surface-card__index">Expired</p>
            <strong className="metric-card__value">
              {formatCount(overview.byStatus.expired ?? 0)}
            </strong>
          </article>
          <article className="metric-card">
            <p className="surface-card__index">Hidden</p>
            <strong className="metric-card__value">
              {formatCount(overview.byStatus.hidden ?? 0)}
            </strong>
          </article>
          <article className="metric-card">
            <p className="surface-card__index">Deleted</p>
            <strong className="metric-card__value">
              {formatCount(overview.byStatus.deleted ?? 0)}
            </strong>
          </article>
          <article className="metric-card">
            <p className="surface-card__index">Consumed</p>
            <strong className="metric-card__value">
              {formatCount(overview.byStatus.consumed ?? 0)}
            </strong>
          </article>
          <article className="metric-card">
            <p className="surface-card__index">Storage</p>
            <strong className="metric-card__value">
              {formatBytes(overview.totalStorageBytes)}
            </strong>
          </article>
          <article className="metric-card">
            <p className="surface-card__index">Downloads</p>
            <strong className="metric-card__value">{formatCount(overview.totalDownloads)}</strong>
          </article>
        </div>
      </section>

      <section className="panel">
        <p className="panel__label">
          Operational signals ({stats.abuseMetrics.windowDays}d window)
        </p>
        <div className="metric-grid">
          <article className="metric-card">
            <p className="surface-card__index">Open anomalies</p>
            <strong className="metric-card__value">{formatCount(stats.openAnomaliesTotal)}</strong>
          </article>
          <article className="metric-card">
            <p className="surface-card__index">Failed jobs</p>
            <strong className="metric-card__value">{formatCount(queueFailures)}</strong>
          </article>
          <article className="metric-card">
            <p className="surface-card__index">Worst lag</p>
            <strong className="metric-card__value">{formatLag(maxLagMs)}</strong>
          </article>
          <article className="metric-card">
            <p className="surface-card__index">Pending reports</p>
            <strong className="metric-card__value">
              {formatCount(stats.reportTotals.byStatus.pending)}
            </strong>
          </article>
          <article className="metric-card">
            <p className="surface-card__index">Reports ({stats.abuseMetrics.windowDays}d)</p>
            <strong className="metric-card__value">{formatCount(reportsInWindow)}</strong>
          </article>
          <article className="metric-card">
            <p className="surface-card__index">Auto-hidden ({stats.abuseMetrics.windowDays}d)</p>
            <strong className="metric-card__value">{formatCount(autoHiddenInWindow)}</strong>
          </article>
          <article className="metric-card">
            <p className="surface-card__index">
              Rate-limit blocks ({stats.abuseMetrics.windowDays}d)
            </p>
            <strong className="metric-card__value">{formatCount(rateLimitBlockedInWindow)}</strong>
          </article>
          <article className="metric-card">
            <p className="surface-card__index">Resolved reports</p>
            <strong className="metric-card__value">
              {formatCount(stats.reportTotals.byStatus.resolved)}
            </strong>
          </article>
        </div>
      </section>
    </>
  );
}
