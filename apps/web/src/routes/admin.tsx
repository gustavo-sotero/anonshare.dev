import {
  type AdminAnomaliesResponse,
  type AdminFileDetail,
  type AdminFileDetailResponse,
  type AdminFileListResponse,
  type AdminFileSummary,
  type AdminLifecycleStatsResponse,
  type AdminReportListResponse,
  type AdminReportSummary,
  type AdminSession,
  type AdminSessionResponse,
  adminAnomaliesResponseSchema,
  adminFileDetailResponseSchema,
  adminFileListResponseSchema,
  adminLifecycleStatsResponseSchema,
  adminReportListResponseSchema,
  adminSessionResponseSchema,
  type OperationalAnomalySummary,
  type QueueHealthSnapshot
} from '@anonshare/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { SiteFrame } from '~/components/site-frame';

export const Route = createFileRoute('/admin')({
  head: () => ({
    meta: [{ title: 'anonshare | Admin' }, { name: 'robots', content: 'noindex, nofollow' }]
  }),
  component: AdminLifecyclePage
});

type DashboardState =
  | { kind: 'loading' }
  | { kind: 'unauthenticated' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready';
      session: AdminSession;
      stats: AdminLifecycleStatsResponse;
      anomalies: OperationalAnomalySummary[];
      hiddenFiles: AdminFileSummary[];
      hiddenFilesTotal: number;
      reports: AdminReportSummary[];
      reportsTotal: number;
      refreshedAt: string;
    };

const REPORT_PAGE_SIZE = 12;
const HIDDEN_FILE_PAGE_SIZE = 8;

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
});

class AdminAccessError extends Error {
  constructor() {
    super('Admin session required');
    this.name = 'AdminAccessError';
  }
}

async function parseJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function extractErrorMessage(body: unknown, fallback: string): string {
  if (typeof body !== 'object' || body === null) {
    return fallback;
  }

  if ('message' in body && typeof (body as { message: unknown }).message === 'string') {
    return (body as { message: string }).message;
  }

  if (
    'error' in body &&
    typeof (body as { error: unknown }).error === 'object' &&
    (body as { error: Record<string, unknown> }).error !== null &&
    typeof (body as { error: { message?: unknown } }).error.message === 'string'
  ) {
    return (body as { error: { message: string } }).error.message;
  }

  return fallback;
}

async function fetchAdminJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    signal
  });
  const body = await parseJsonBody(response);

  if (response.status === 401 || response.status === 403) {
    throw new AdminAccessError();
  }

  if (!response.ok) {
    const message = extractErrorMessage(body, `Request failed with status ${response.status}.`);
    throw new Error(message);
  }

  return body;
}

async function fetchAdminSession(signal: AbortSignal): Promise<AdminSessionResponse> {
  const body = await fetchAdminJson('/api/admin/session', signal);

  const parsed = adminSessionResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error('Admin session response validation failed.');
  }

  return parsed.data;
}

async function fetchAdminStats(signal: AbortSignal): Promise<AdminLifecycleStatsResponse> {
  const body = await fetchAdminJson('/api/admin/stats', signal);

  const parsed = adminLifecycleStatsResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error('Admin stats response validation failed.');
  }

  return parsed.data;
}

async function fetchAdminAnomalies(signal: AbortSignal): Promise<AdminAnomaliesResponse> {
  const body = await fetchAdminJson('/api/admin/anomalies?limit=12', signal);

  const parsed = adminAnomaliesResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error('Admin anomalies response validation failed.');
  }

  return parsed.data;
}

async function fetchAdminReports(signal: AbortSignal): Promise<AdminReportListResponse> {
  const body = await fetchAdminJson(
    `/api/admin/reports?status=pending&page=1&pageSize=${REPORT_PAGE_SIZE}`,
    signal
  );

  const parsed = adminReportListResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error('Admin reports response validation failed.');
  }

  return parsed.data;
}

async function fetchAdminHiddenFiles(signal: AbortSignal): Promise<AdminFileListResponse> {
  const body = await fetchAdminJson(
    `/api/admin/files?status=hidden&page=1&pageSize=${HIDDEN_FILE_PAGE_SIZE}`,
    signal
  );

  const parsed = adminFileListResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error('Admin hidden files response validation failed.');
  }

  return parsed.data;
}

async function fetchAdminFileDetail(
  fileId: string,
  signal: AbortSignal
): Promise<AdminFileDetailResponse> {
  const body = await fetchAdminJson(`/api/admin/files/${fileId}`, signal);

  const parsed = adminFileDetailResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error('Admin file detail response validation failed.');
  }

  return parsed.data;
}

async function loadDashboardState(signal: AbortSignal): Promise<DashboardState> {
  const sessionResponse = await fetchAdminSession(signal);

  if (!sessionResponse.authenticated || !sessionResponse.session) {
    return { kind: 'unauthenticated' };
  }

  const [statsResponse, anomaliesResponse, reportsResponse, hiddenFilesResponse] =
    await Promise.all([
      fetchAdminStats(signal),
      fetchAdminAnomalies(signal),
      fetchAdminReports(signal),
      fetchAdminHiddenFiles(signal)
    ]);

  return {
    kind: 'ready',
    session: sessionResponse.session,
    stats: statsResponse,
    anomalies: anomaliesResponse.anomalies,
    hiddenFiles: hiddenFilesResponse.files,
    hiddenFilesTotal: hiddenFilesResponse.total,
    reports: reportsResponse.reports,
    reportsTotal: reportsResponse.total,
    refreshedAt: new Date().toISOString()
  };
}

function formatDateTime(value: string): string {
  return dateTimeFormatter.format(new Date(value));
}

function formatLag(lagMs: number): string {
  if (lagMs < 1_000) {
    return `${lagMs} ms`;
  }

  if (lagMs < 60_000) {
    return `${(lagMs / 1_000).toFixed(1)} s`;
  }

  return `${(lagMs / 60_000).toFixed(1)} min`;
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) {
    return 'n/a';
  }

  return formatLag(durationMs);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatFileBytes(value: number): string {
  if (value < 1024) {
    return `${formatCount(value)} bytes`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = -1;

  do {
    size /= 1024;
    unitIndex += 1;
  } while (size >= 1024 && unitIndex < units.length - 1);

  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: size >= 100 ? 0 : 1
  }).format(size)} ${units[unitIndex]}`;
}

function formatOptionalDateTime(value: string | null): string {
  return value ? formatDateTime(value) : 'n/a';
}

function formatAnomalyType(type: OperationalAnomalySummary['type']): string {
  return type.replaceAll('_', ' ');
}

function summarizeQueueState(queue: QueueHealthSnapshot): string {
  if (queue.status === 'degraded') {
    return 'Degraded';
  }

  if (queue.failed > 0) {
    return 'Needs attention';
  }

  if (queue.active > 0 || queue.waiting > 0) {
    return 'Working';
  }

  if (queue.delayed > 0) {
    return 'Scheduled';
  }

  return 'Idle';
}

function formatDetailValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value === null || value === undefined) {
    return 'n/a';
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getAnomalyDetails(details: OperationalAnomalySummary['details']) {
  return Object.entries(details ?? {})
    .filter(([key]) => key !== 'severity' && key !== 'fingerprint')
    .slice(0, 4);
}

function formatReportReason(reason: AdminReportSummary['reason']): string {
  return reason.replaceAll('_', ' ');
}

function formatFileStatus(status: AdminFileSummary['status']): string {
  return status.replaceAll('_', ' ');
}

function formatModerationTransition(previousStatus: string, nextStatus: string): string {
  return `${formatFileStatus(previousStatus as AdminFileSummary['status'])} → ${formatFileStatus(nextStatus as AdminFileSummary['status'])}`;
}

function QueueCard({ queue }: { queue: QueueHealthSnapshot }) {
  return (
    <article className="surface-card queue-card">
      <div className="queue-card__header">
        <div>
          <p className="surface-card__index">{queue.queue}</p>
          <h2>{summarizeQueueState(queue)}</h2>
        </div>
        <span className="chip chip--outline">
          {queue.status === 'degraded' ? 'Telemetry degraded' : `Lag ${formatLag(queue.lagMs)}`}
        </span>
      </div>

      {queue.status === 'degraded' && queue.lastError ? (
        <p className="panel__copy">Queue telemetry is temporarily unavailable: {queue.lastError}</p>
      ) : null}

      <div className="queue-card__stats">
        <div className="queue-card__stat">
          <span>Waiting</span>
          <strong>{formatCount(queue.waiting)}</strong>
        </div>
        <div className="queue-card__stat">
          <span>Active</span>
          <strong>{formatCount(queue.active)}</strong>
        </div>
        <div className="queue-card__stat">
          <span>Delayed</span>
          <strong>{formatCount(queue.delayed)}</strong>
        </div>
        <div className="queue-card__stat">
          <span>Failed</span>
          <strong>{formatCount(queue.failed)}</strong>
        </div>
        <div className="queue-card__stat">
          <span>Completed</span>
          <strong>{formatCount(queue.completed)}</strong>
        </div>
        <div className="queue-card__stat">
          <span>Avg duration</span>
          <strong>{formatDuration(queue.processing.avgDurationMs)}</strong>
        </div>
        <div className="queue-card__stat">
          <span>P95 duration</span>
          <strong>{formatDuration(queue.processing.p95DurationMs)}</strong>
        </div>
        <div className="queue-card__stat">
          <span>Retry rate</span>
          <strong>{formatPercent(queue.processing.retryRate)}</strong>
        </div>
        <div className="queue-card__stat">
          <span>Retried jobs</span>
          <strong>
            {formatCount(queue.processing.retriedJobs)} /{' '}
            {formatCount(queue.processing.sampledJobs)}
          </strong>
        </div>
      </div>
    </article>
  );
}

function AdminRail({ state }: { state: DashboardState }) {
  return (
    <>
      <section className="panel panel--muted">
        <p className="panel__label">Lifecycle scope</p>
        <div className="status-list">
          <div className="status-item">
            <span>Immediate read block</span>
            <strong>Expired files stop serving before cleanup runs.</strong>
          </div>
          <div className="status-item">
            <span>Queue repair</span>
            <strong>Reconcile restores missing expire and cleanup jobs.</strong>
          </div>
          <div className="status-item">
            <span>Storage integrity</span>
            <strong>Missing objects and orphaned objects surface as anomalies.</strong>
          </div>
        </div>
      </section>

      <section className="panel panel--muted">
        <p className="panel__label">Operator context</p>
        {state.kind === 'ready' ? (
          <div className="status-list">
            <div className="status-item">
              <span>Signed in as</span>
              <strong>{state.session.githubLogin}</strong>
            </div>
            <div className="status-item">
              <span>Session expires</span>
              <strong>{formatDateTime(state.session.expiresAt)}</strong>
            </div>
            <div className="status-item">
              <span>Last refresh</span>
              <strong>{formatDateTime(state.refreshedAt)}</strong>
            </div>
          </div>
        ) : (
          <p className="panel__copy">
            This surface becomes live when the browser has a valid allowlisted admin session.
          </p>
        )}
      </section>
    </>
  );
}

function AdminLifecyclePage() {
  const [state, setState] = useState<DashboardState>({ kind: 'loading' });
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [reportActionPendingId, setReportActionPendingId] = useState<string | null>(null);
  const [reportActionError, setReportActionError] = useState<string | null>(null);
  const [fileActionPendingId, setFileActionPendingId] = useState<string | null>(null);
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedFileDetail, setSelectedFileDetail] = useState<AdminFileDetail | null>(null);
  const [selectedFileDetailError, setSelectedFileDetailError] = useState<string | null>(null);
  const [isFileDetailLoading, setIsFileDetailLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    if (refreshKey === 0) {
      setState({ kind: 'loading' });
    } else {
      setIsRefreshing(true);
    }

    loadDashboardState(controller.signal)
      .then((nextState) => {
        setState(nextState);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        if (error instanceof AdminAccessError) {
          setState({ kind: 'unauthenticated' });
          return;
        }

        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Failed to load lifecycle telemetry.'
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsRefreshing(false);
        }
      });

    return () => controller.abort();
  }, [refreshKey]);

  useEffect(() => {
    const detailSnapshot = state.kind === 'ready' ? state.refreshedAt : null;

    if (!selectedFileId || !detailSnapshot) {
      if (!selectedFileId) {
        setSelectedFileDetail(null);
        setSelectedFileDetailError(null);
        setIsFileDetailLoading(false);
      }
      return;
    }

    const controller = new AbortController();
    setIsFileDetailLoading(true);
    setSelectedFileDetailError(null);

    fetchAdminFileDetail(selectedFileId, controller.signal)
      .then((response) => {
        setSelectedFileDetail(response.file);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        if (error instanceof AdminAccessError) {
          setState({ kind: 'unauthenticated' });
          return;
        }

        setSelectedFileDetail(null);
        setSelectedFileDetailError(
          error instanceof Error ? error.message : 'Failed to load file inspection detail.'
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsFileDetailLoading(false);
        }
      });

    return () => controller.abort();
  }, [selectedFileId, state]);

  const refresh = () => setRefreshKey((current) => current + 1);
  const openFileDetail = (fileId: string) => {
    setSelectedFileId(fileId);
  };

  const resolveReport = async (reportId: string, action: 'resolved' | 'dismissed') => {
    setReportActionPendingId(reportId);
    setReportActionError(null);

    try {
      const response = await fetch(`/api/admin/reports/${reportId}/resolve`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json'
        },
        credentials: 'same-origin',
        body: JSON.stringify({ action })
      });
      const body = await parseJsonBody(response);

      if (response.status === 401 || response.status === 403) {
        throw new AdminAccessError();
      }

      if (!response.ok) {
        throw new Error(extractErrorMessage(body, 'Failed to resolve report.'));
      }

      refresh();
    } catch (error: unknown) {
      if (error instanceof AdminAccessError) {
        setState({ kind: 'unauthenticated' });
        return;
      }

      setReportActionError(
        error instanceof Error ? error.message : 'Failed to resolve report action.'
      );
    } finally {
      setReportActionPendingId(null);
    }
  };

  const moderateFile = async (fileId: string, action: 'hide' | 'restore' | 'delete') => {
    setFileActionPendingId(fileId);
    setFileActionError(null);

    try {
      const response = await fetch(`/api/admin/files/${fileId}/moderate`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json'
        },
        credentials: 'same-origin',
        body: JSON.stringify({ action })
      });
      const body = await parseJsonBody(response);

      if (response.status === 401 || response.status === 403) {
        throw new AdminAccessError();
      }

      if (!response.ok) {
        throw new Error(extractErrorMessage(body, 'Failed to update file moderation state.'));
      }

      refresh();
    } catch (error: unknown) {
      if (error instanceof AdminAccessError) {
        setState({ kind: 'unauthenticated' });
        return;
      }

      setFileActionError(
        error instanceof Error ? error.message : 'Failed to update file moderation state.'
      );
    } finally {
      setFileActionPendingId(null);
    }
  };

  const queueFailures =
    state.kind === 'ready'
      ? state.stats.queueHealth.reduce((sum, queue) => sum + queue.failed, 0)
      : 0;
  const scheduledJobs =
    state.kind === 'ready'
      ? state.stats.queueHealth.reduce((sum, queue) => sum + queue.delayed, 0)
      : 0;
  const maxLagMs =
    state.kind === 'ready'
      ? state.stats.queueHealth.reduce((max, queue) => Math.max(max, queue.lagMs), 0)
      : 0;
  const reportsInWindow =
    state.kind === 'ready'
      ? state.stats.abuseMetrics.reportsByDay.reduce((sum, row) => sum + row.count, 0)
      : 0;
  const autoHiddenInWindow =
    state.kind === 'ready'
      ? state.stats.abuseMetrics.autoHiddenByDay.reduce((sum, row) => sum + row.count, 0)
      : 0;
  const resolvedReportsInWindow =
    state.kind === 'ready'
      ? state.stats.abuseMetrics.resolvedReportsByDay.reduce((sum, row) => sum + row.count, 0)
      : 0;
  const dismissedReportsInWindow =
    state.kind === 'ready'
      ? state.stats.abuseMetrics.dismissedReportsByDay.reduce((sum, row) => sum + row.count, 0)
      : 0;
  const rateLimitBlockedInWindow =
    state.kind === 'ready'
      ? state.stats.abuseMetrics.rateLimitBlockedByDay.reduce((sum, row) => sum + row.count, 0)
      : 0;

  return (
    <SiteFrame
      eyebrow="Operations dashboard"
      title="Abuse signals, moderation backlog, and lifecycle health in one place."
      summary="The operator surface now combines moderation decisions, hidden-file recovery, anomaly backlog, and queue telemetry from the API boundary."
      rail={<AdminRail state={state} />}
    >
      {state.kind === 'loading' && (
        <section className="panel panel--feature">
          <p className="panel__label">Connecting</p>
          <p className="panel__copy">
            Checking the current admin session and loading lifecycle telemetry.
          </p>
        </section>
      )}

      {state.kind === 'unauthenticated' && (
        <section className="panel panel--feature">
          <div className="panel__row">
            <p className="panel__label">Admin access</p>
            <span className="chip chip--outline">Session required</span>
          </div>
          <p className="panel__copy">
            This page only reveals anomaly backlog and queue health when the browser presents a
            valid allowlisted admin session. The data layer is live; the login flow lands with the
            dedicated authentication module.
          </p>
          <div className="surface-grid surface-grid--narrow metric-grid">
            <article className="metric-card">
              <p className="surface-card__index">Signal 1</p>
              <strong className="metric-card__value">Anomalies</strong>
              <p className="metric-card__meta">
                Missing objects, failed cleanup, stale expirations.
              </p>
            </article>
            <article className="metric-card">
              <p className="surface-card__index">Signal 2</p>
              <strong className="metric-card__value">Queues</strong>
              <p className="metric-card__meta">Lag, delayed jobs, and failed lifecycle workers.</p>
            </article>
            <article className="metric-card">
              <p className="surface-card__index">Signal 3</p>
              <strong className="metric-card__value">Reconcile</strong>
              <p className="metric-card__meta">Repairs missed expiration and cleanup work.</p>
            </article>
          </div>
        </section>
      )}

      {state.kind === 'error' && (
        <section className="panel panel--feature">
          <div className="panel__row">
            <p className="panel__label">Load failed</p>
            <span className="chip chip--error">Retry needed</span>
          </div>
          <p className="panel__copy">{state.message}</p>
          <div className="action-row">
            <button type="button" className="button-link" onClick={refresh}>
              Try again
            </button>
          </div>
        </section>
      )}

      {state.kind === 'ready' && (
        <>
          <section className="panel panel--feature">
            <div className="admin-toolbar">
              <div className="admin-toolbar__content">
                <p className="panel__label">Operator telemetry</p>
                <h2 className="admin-section-title">Lifecycle signals are live.</h2>
                <p className="panel__copy">
                  Signed in as {state.session.githubLogin}. This surface reads from /api/admin/stats
                  , /api/admin/anomalies, and /api/admin/reports to expose lifecycle and moderation
                  backlog.
                </p>
              </div>

              <div className="admin-toolbar__actions">
                <span className="chip chip--outline">{isRefreshing ? 'Refreshing' : 'Live'}</span>
                <button
                  type="button"
                  className="button-link button-link--ghost"
                  onClick={refresh}
                  disabled={isRefreshing}
                >
                  Refresh
                </button>
              </div>
            </div>

            <div className="metric-grid">
              <article className="metric-card">
                <p className="surface-card__index">Open anomalies</p>
                <strong className="metric-card__value">
                  {formatCount(state.stats.openAnomaliesTotal)}
                </strong>
                <p className="metric-card__meta">Unresolved lifecycle inconsistencies.</p>
              </article>

              <article className="metric-card">
                <p className="surface-card__index">Failed jobs</p>
                <strong className="metric-card__value">{formatCount(queueFailures)}</strong>
                <p className="metric-card__meta">
                  Total failed jobs across expire, cleanup, and reconcile.
                </p>
              </article>

              <article className="metric-card">
                <p className="surface-card__index">Worst lag</p>
                <strong className="metric-card__value">{formatLag(maxLagMs)}</strong>
                <p className="metric-card__meta">Longest queue delay currently visible.</p>
              </article>

              <article className="metric-card">
                <p className="surface-card__index">Delayed jobs</p>
                <strong className="metric-card__value">{formatCount(scheduledJobs)}</strong>
                <p className="metric-card__meta">Jobs waiting for future lifecycle deadlines.</p>
              </article>

              <article className="metric-card">
                <p className="surface-card__index">
                  Reports ({state.stats.abuseMetrics.windowDays}d)
                </p>
                <strong className="metric-card__value">{formatCount(reportsInWindow)}</strong>
                <p className="metric-card__meta">Public report volume in the recent window.</p>
              </article>

              <article className="metric-card">
                <p className="surface-card__index">
                  Auto-hidden ({state.stats.abuseMetrics.windowDays}d)
                </p>
                <strong className="metric-card__value">{formatCount(autoHiddenInWindow)}</strong>
                <p className="metric-card__meta">
                  Files hidden automatically after threshold hits.
                </p>
              </article>

              <article className="metric-card">
                <p className="surface-card__index">
                  Reports resolved ({state.stats.abuseMetrics.windowDays}d)
                </p>
                <strong className="metric-card__value">
                  {formatCount(resolvedReportsInWindow)}
                </strong>
                <p className="metric-card__meta">Reports confirmed and resolved by admin.</p>
              </article>

              <article className="metric-card">
                <p className="surface-card__index">
                  Reports dismissed ({state.stats.abuseMetrics.windowDays}d)
                </p>
                <strong className="metric-card__value">
                  {formatCount(dismissedReportsInWindow)}
                </strong>
                <p className="metric-card__meta">
                  Reports dismissed as false positives or non-actionable.
                </p>
              </article>

              <article className="metric-card">
                <p className="surface-card__index">
                  Rate-limit blocks ({state.stats.abuseMetrics.windowDays}d)
                </p>
                <strong className="metric-card__value">
                  {formatCount(rateLimitBlockedInWindow)}
                </strong>
                <p className="metric-card__meta">
                  Total blocked requests across upload, report, share, download, and preview.
                </p>
              </article>
            </div>
          </section>

          <section className="panel">
            <div className="panel__row">
              <p className="panel__label">Queue health</p>
              <span className="chip chip--outline">{state.stats.queueHealth.length} queues</span>
            </div>

            <div className="surface-grid surface-grid--narrow admin-queue-grid">
              {state.stats.queueHealth.map((queue) => (
                <QueueCard key={queue.queue} queue={queue} />
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel__row">
              <p className="panel__label">Report queue</p>
              <span className="chip chip--outline">
                {state.reportsTotal === 0
                  ? 'No pending reports'
                  : `${formatCount(state.reports.length)} shown / ${formatCount(state.reportsTotal)} pending`}
              </span>
            </div>

            {reportActionError ? <p className="upload-error">{reportActionError}</p> : null}

            {state.reports.length === 0 ? (
              <div className="state-empty">
                <strong>No pending reports in queue.</strong>
                <p className="panel__copy">
                  New public reports will show up here for moderation actions.
                </p>
              </div>
            ) : (
              <div className="report-queue">
                {state.reports.map((report) => (
                  <article key={report.id} className="report-card">
                    <div className="report-card__header">
                      <div>
                        <p className="surface-card__index">{formatReportReason(report.reason)}</p>
                        <h2>File {report.fileId.slice(0, 8)}</h2>
                      </div>
                      <span className="chip chip--outline">{formatDateTime(report.createdAt)}</span>
                    </div>

                    <p className="panel__copy report-card__message">
                      {report.message?.trim() || 'No additional context provided.'}
                    </p>

                    <p className="panel__copy report-card__meta">
                      Status {report.status} · file {report.fileId.slice(0, 8)}
                    </p>

                    <div className="report-card__actions">
                      <button
                        type="button"
                        className="button-link button-link--sm"
                        disabled={isRefreshing || reportActionPendingId === report.id}
                        onClick={() => resolveReport(report.id, 'resolved')}
                      >
                        {reportActionPendingId === report.id ? 'Saving...' : 'Resolve'}
                      </button>
                      <button
                        type="button"
                        className="button-link button-link--ghost button-link--sm"
                        disabled={isRefreshing || fileActionPendingId === report.fileId}
                        onClick={() => moderateFile(report.fileId, 'hide')}
                      >
                        {fileActionPendingId === report.fileId ? 'Saving...' : 'Hide file'}
                      </button>
                      <button
                        type="button"
                        className="button-link button-link--ghost button-link--sm"
                        disabled={isRefreshing || reportActionPendingId === report.id}
                        onClick={() => resolveReport(report.id, 'dismissed')}
                      >
                        Dismiss
                      </button>
                      <button
                        type="button"
                        className="button-link button-link--ghost button-link--sm"
                        disabled={isRefreshing}
                        onClick={() => openFileDetail(report.fileId)}
                      >
                        {selectedFileId === report.fileId ? 'Inspecting' : 'Inspect file'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel__row">
              <p className="panel__label">Hidden files</p>
              <span className="chip chip--outline">
                {state.hiddenFilesTotal === 0
                  ? 'No hidden files'
                  : `${formatCount(state.hiddenFiles.length)} shown / ${formatCount(state.hiddenFilesTotal)} hidden`}
              </span>
            </div>

            {fileActionError ? <p className="upload-error">{fileActionError}</p> : null}

            {state.hiddenFiles.length === 0 ? (
              <div className="state-empty">
                <strong>No hidden files waiting for review.</strong>
                <p className="panel__copy">
                  Auto-hidden and manually hidden files will appear here for restore or deletion.
                </p>
              </div>
            ) : (
              <div className="report-queue">
                {state.hiddenFiles.map((file) => (
                  <article key={file.id} className="report-card">
                    <div className="report-card__header">
                      <div>
                        <p className="surface-card__index">{formatFileStatus(file.status)}</p>
                        <h2>{file.sanitizedFilename}</h2>
                      </div>
                      <span className="chip chip--outline">
                        {formatCount(file.reportCount)} reports
                      </span>
                    </div>

                    <p className="panel__copy report-card__message">
                      {formatFileStatus(file.status)} · {formatFileBytes(file.sizeBytes)}
                      {file.expiresAt
                        ? ` · expires ${formatDateTime(file.expiresAt)}`
                        : ' · no expiration'}
                    </p>

                    <div className="report-card__actions">
                      <button
                        type="button"
                        className="button-link button-link--sm"
                        disabled={isRefreshing || fileActionPendingId === file.id}
                        onClick={() => moderateFile(file.id, 'restore')}
                      >
                        {fileActionPendingId === file.id ? 'Saving...' : 'Restore'}
                      </button>
                      <button
                        type="button"
                        className="button-link button-link--ghost button-link--sm"
                        disabled={isRefreshing || fileActionPendingId === file.id}
                        onClick={() => moderateFile(file.id, 'delete')}
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        className="button-link button-link--ghost button-link--sm"
                        disabled={isRefreshing}
                        onClick={() => openFileDetail(file.id)}
                      >
                        {selectedFileId === file.id ? 'Inspecting' : 'Inspect file'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel__row">
              <p className="panel__label">File inspection</p>
              <span className="chip chip--outline">
                {selectedFileId
                  ? isFileDetailLoading
                    ? 'Loading detail'
                    : selectedFileDetail
                      ? formatFileStatus(selectedFileDetail.status)
                      : 'Detail unavailable'
                  : 'Select a file'}
              </span>
            </div>

            {!selectedFileId ? (
              <div className="state-empty">
                <strong>Select a reported or hidden file.</strong>
                <p className="panel__copy">
                  This inspection panel exposes the file status, report trail, and moderation
                  history already stored by the API.
                </p>
              </div>
            ) : isFileDetailLoading ? (
              <div className="state-empty">
                <strong>Loading inspection detail.</strong>
                <p className="panel__copy">
                  Fetching the latest report and moderation history for this file.
                </p>
              </div>
            ) : selectedFileDetailError ? (
              <div className="state-empty">
                <strong>Inspection detail failed.</strong>
                <p className="panel__copy">{selectedFileDetailError}</p>
              </div>
            ) : selectedFileDetail ? (
              <div className="admin-detail-stack">
                <article className="report-card report-card--selected">
                  <div className="report-card__header">
                    <div>
                      <p className="surface-card__index">{selectedFileDetail.sanitizedFilename}</p>
                      <h2>{formatFileStatus(selectedFileDetail.status)}</h2>
                    </div>
                    <div className="report-card__chips">
                      <span className="chip chip--outline">
                        {formatCount(selectedFileDetail.reportCount)} reports
                      </span>
                      <button
                        type="button"
                        className="button-link button-link--ghost button-link--sm"
                        onClick={() => setSelectedFileId(null)}
                      >
                        Close
                      </button>
                    </div>
                  </div>

                  <div className="admin-detail-grid">
                    <div className="queue-card__stat">
                      <span>Share token</span>
                      <strong>{selectedFileDetail.token}</strong>
                    </div>
                    <div className="queue-card__stat">
                      <span>Size</span>
                      <strong>{formatFileBytes(selectedFileDetail.sizeBytes)}</strong>
                    </div>
                    <div className="queue-card__stat">
                      <span>Uploaded</span>
                      <strong>{formatDateTime(selectedFileDetail.uploadedAt)}</strong>
                    </div>
                    <div className="queue-card__stat">
                      <span>Expires</span>
                      <strong>{formatOptionalDateTime(selectedFileDetail.expiresAt)}</strong>
                    </div>
                    <div className="queue-card__stat">
                      <span>Preview</span>
                      <strong>{selectedFileDetail.allowPreview ? 'Allowed' : 'Blocked'}</strong>
                    </div>
                    <div className="queue-card__stat">
                      <span>One-time download</span>
                      <strong>{selectedFileDetail.oneTimeDownload ? 'Enabled' : 'Disabled'}</strong>
                    </div>
                    <div className="queue-card__stat">
                      <span>Consumed</span>
                      <strong>{formatOptionalDateTime(selectedFileDetail.consumedAt)}</strong>
                    </div>
                    <div className="queue-card__stat">
                      <span>Deleted</span>
                      <strong>{formatOptionalDateTime(selectedFileDetail.deletedAt)}</strong>
                    </div>
                  </div>
                </article>

                <div className="admin-detail-grid admin-detail-grid--columns">
                  <article className="report-card admin-detail-panel">
                    <div className="report-card__header">
                      <div>
                        <p className="surface-card__index">Report trail</p>
                        <h2>{formatCount(selectedFileDetail.reports.length)} reports recorded</h2>
                      </div>
                    </div>

                    {selectedFileDetail.reports.length === 0 ? (
                      <div className="state-empty">
                        <strong>No reports stored for this file.</strong>
                        <p className="panel__copy">
                          This file has not accumulated a report trail yet.
                        </p>
                      </div>
                    ) : (
                      <div className="admin-detail-list">
                        {selectedFileDetail.reports.map((report) => (
                          <article key={report.id} className="report-card report-card--compact">
                            <div className="report-card__header">
                              <div>
                                <p className="surface-card__index">
                                  {formatReportReason(report.reason)}
                                </p>
                                <h2>{report.status}</h2>
                              </div>
                              <span className="chip chip--outline">
                                {formatDateTime(report.createdAt)}
                              </span>
                            </div>

                            <p className="panel__copy report-card__message">
                              {report.message?.trim() || 'No additional context provided.'}
                            </p>

                            <dl className="detail-pairs">
                              <div className="detail-pairs__row">
                                <dt>Resolved by</dt>
                                <dd>{report.resolvedBy ?? 'Pending review'}</dd>
                              </div>
                              <div className="detail-pairs__row">
                                <dt>Resolved at</dt>
                                <dd>{formatOptionalDateTime(report.resolvedAt)}</dd>
                              </div>
                            </dl>
                          </article>
                        ))}
                      </div>
                    )}
                  </article>

                  <article className="report-card admin-detail-panel">
                    <div className="report-card__header">
                      <div>
                        <p className="surface-card__index">Moderation history</p>
                        <h2>
                          {formatCount(selectedFileDetail.moderationHistory.length)} actions logged
                        </h2>
                      </div>
                    </div>

                    {selectedFileDetail.moderationHistory.length === 0 ? (
                      <div className="state-empty">
                        <strong>No moderation actions recorded.</strong>
                        <p className="panel__copy">
                          Automatic or manual availability changes will appear here.
                        </p>
                      </div>
                    ) : (
                      <div className="admin-detail-list">
                        {selectedFileDetail.moderationHistory.map((entry) => (
                          <article key={entry.id} className="report-card report-card--compact">
                            <div className="report-card__header">
                              <div>
                                <p className="surface-card__index">{entry.action}</p>
                                <h2>
                                  {formatModerationTransition(
                                    entry.previousStatus,
                                    entry.nextStatus
                                  )}
                                </h2>
                              </div>
                              <span className="chip chip--outline">
                                {formatDateTime(entry.createdAt)}
                              </span>
                            </div>

                            <dl className="detail-pairs">
                              <div className="detail-pairs__row">
                                <dt>Actor</dt>
                                <dd>{entry.actorGithubLogin}</dd>
                              </div>
                              <div className="detail-pairs__row">
                                <dt>Reason</dt>
                                <dd>{entry.reason ?? 'No internal note.'}</dd>
                              </div>
                            </dl>
                          </article>
                        ))}
                      </div>
                    )}
                  </article>
                </div>
              </div>
            ) : null}
          </section>

          <section className="panel">
            <div className="panel__row">
              <p className="panel__label">Anomaly backlog</p>
              <span className="chip chip--outline">
                {state.anomalies.length === 0 ? 'Clear' : `${state.anomalies.length} visible`}
              </span>
            </div>

            {state.anomalies.length === 0 ? (
              <div className="state-empty">
                <strong>No unresolved lifecycle anomalies.</strong>
                <p className="panel__copy">
                  Reconciliation is not reporting any open storage or expiration mismatches right
                  now.
                </p>
              </div>
            ) : (
              <div className="anomaly-list">
                {state.anomalies.map((anomaly) => (
                  <article key={anomaly.id} className="anomaly-card">
                    <div className="anomaly-card__header">
                      <div>
                        <p className="surface-card__index">{formatAnomalyType(anomaly.type)}</p>
                        <h2>
                          {anomaly.fileId
                            ? `File ${anomaly.fileId.slice(0, 8)}`
                            : 'Storage-only anomaly'}
                        </h2>
                      </div>
                      <span className={`chip chip--severity chip--severity-${anomaly.severity}`}>
                        {anomaly.severity}
                      </span>
                    </div>

                    <div className="anomaly-card__meta">
                      <div className="queue-card__stat">
                        <span>Detected</span>
                        <strong>{formatDateTime(anomaly.detectedAt)}</strong>
                      </div>
                      <div className="queue-card__stat">
                        <span>Resolution</span>
                        <strong>{anomaly.resolution ?? 'Open'}</strong>
                      </div>
                    </div>

                    {getAnomalyDetails(anomaly.details).length > 0 && (
                      <dl className="detail-pairs">
                        {getAnomalyDetails(anomaly.details).map(([key, value]) => (
                          <div key={key} className="detail-pairs__row">
                            <dt>{key}</dt>
                            <dd>{formatDetailValue(value)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </SiteFrame>
  );
}
