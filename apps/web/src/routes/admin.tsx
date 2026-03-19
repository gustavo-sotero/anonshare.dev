import {
  type AdminAnomaliesResponse,
  type AdminDownloadListResponse,
  type AdminFileDetail,
  type AdminFileDetailResponse,
  type AdminFileListResponse,
  type AdminFileSummary,
  type AdminLifecycleStatsResponse,
  type AdminOverviewResponse,
  type AdminReportListResponse,
  type AdminReportSummary,
  type AdminSession,
  type AdminSessionResponse,
  adminAnomaliesResponseSchema,
  adminDownloadListResponseSchema,
  adminFileDetailResponseSchema,
  adminFileListResponseSchema,
  adminLifecycleStatsResponseSchema,
  adminOverviewResponseSchema,
  adminReportListResponseSchema,
  adminSessionResponseSchema,
  type OperationalAnomalySummary,
  type QueueHealthSnapshot
} from '@anonshare/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import {
  AdminAccessError,
  createAdminAccessError,
  getAdminAccessErrorMessage
} from '~/admin/access';
import {
  type AdminModerationAction,
  buildStorageHighlights,
  canHideFileStatus,
  getModerationConfirmationMessage
} from '~/admin/dashboard';
import { runTrackedRequest, useRequestTracker } from '~/admin/request-tracker';
import { SiteFrame } from '~/components/site-frame';

export const Route = createFileRoute('/admin')({
  head: () => ({
    meta: [{ title: 'anonshare | Admin' }, { name: 'robots', content: 'noindex, nofollow' }]
  }),
  component: AdminPage
});

// ─── Types ───────────────────────────────────────────────────────────────────

type AdminTab = 'overview' | 'files' | 'reports' | 'downloads' | 'storage' | 'queues' | 'anomalies';

type DashboardData = {
  session: AdminSession;
  stats: AdminLifecycleStatsResponse;
  overview: AdminOverviewResponse;
  anomalies: OperationalAnomalySummary[];
  reports: AdminReportSummary[];
  reportsTotal: number;
  refreshedAt: string;
};

type DashboardState =
  | { kind: 'loading' }
  | { kind: 'unauthenticated'; error?: string }
  | { kind: 'error'; message: string }
  | ({ kind: 'ready' } & DashboardData);

// ─── Constants ───────────────────────────────────────────────────────────────

const REPORT_PAGE_SIZE = 20;
const FILE_PAGE_SIZE = 20;
const DOWNLOAD_PAGE_SIZE = 20;

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
});

type OnAdminAccessLost = (error: AdminAccessError) => void;

function confirmModerationAction(action: AdminModerationAction, targetLabel: string): boolean {
  const message = getModerationConfirmationMessage(action, targetLabel);

  if (!message) {
    return true;
  }

  return window.confirm(message);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

async function fetchAdminJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    signal: signal ?? null
  });
  const body = await parseJsonBody(response);

  if (response.status === 401 || response.status === 403) {
    throw createAdminAccessError(response.status, body);
  }

  if (!response.ok) {
    const message = extractErrorMessage(body, `Request failed with status ${response.status}.`);
    throw new Error(message);
  }

  return body;
}

async function postAdminJson(
  url: string,
  data: unknown,
  signal?: AbortSignal
): Promise<{ ok: boolean; body: unknown; status: number }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json'
    },
    credentials: 'same-origin',
    body: JSON.stringify(data),
    signal: signal ?? null
  });
  const body = await parseJsonBody(response);

  if (response.status === 401 || response.status === 403) {
    throw createAdminAccessError(response.status, body);
  }

  return { ok: response.ok, body, status: response.status };
}

async function fetchAdminSession(signal?: AbortSignal): Promise<AdminSessionResponse> {
  const body = await fetchAdminJson('/api/admin/session', signal);
  const parsed = adminSessionResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('Admin session response validation failed.');
  return parsed.data;
}

async function fetchAdminStats(signal?: AbortSignal): Promise<AdminLifecycleStatsResponse> {
  const body = await fetchAdminJson('/api/admin/stats', signal);
  const parsed = adminLifecycleStatsResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('Admin stats response validation failed.');
  return parsed.data;
}

async function fetchAdminOverview(signal?: AbortSignal): Promise<AdminOverviewResponse> {
  const body = await fetchAdminJson('/api/admin/overview', signal);
  const parsed = adminOverviewResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('Admin overview response validation failed.');
  return parsed.data;
}

async function fetchAdminAnomalies(signal?: AbortSignal): Promise<AdminAnomaliesResponse> {
  const body = await fetchAdminJson('/api/admin/anomalies?limit=20', signal);
  const parsed = adminAnomaliesResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('Admin anomalies response validation failed.');
  return parsed.data;
}

async function fetchAdminReports(
  status: string,
  page: number,
  reason: string | null,
  urgency: string | null,
  signal?: AbortSignal
): Promise<AdminReportListResponse> {
  const params = new URLSearchParams({
    status,
    page: String(page),
    pageSize: String(REPORT_PAGE_SIZE)
  });
  if (reason) params.set('reason', reason);
  if (urgency) params.set('urgency', urgency);
  const body = await fetchAdminJson(`/api/admin/reports?${params.toString()}`, signal);
  const parsed = adminReportListResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('Admin reports response validation failed.');
  return parsed.data;
}

async function fetchAdminFiles(
  status: string | null,
  policy: string | null,
  sortBy: string,
  uploadedWithinDays: number | null,
  minReportCount: number | null,
  page: number,
  signal?: AbortSignal
): Promise<AdminFileListResponse> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(FILE_PAGE_SIZE) });
  if (status) params.set('status', status);
  if (policy) params.set('policy', policy);
  params.set('sortBy', sortBy);
  if (uploadedWithinDays !== null) params.set('uploadedWithinDays', String(uploadedWithinDays));
  if (minReportCount !== null) params.set('minReportCount', String(minReportCount));
  const body = await fetchAdminJson(`/api/admin/files?${params.toString()}`, signal);
  const parsed = adminFileListResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('Admin files response validation failed.');
  return parsed.data;
}

async function fetchAdminFileDetail(
  fileId: string,
  signal?: AbortSignal
): Promise<AdminFileDetailResponse> {
  const body = await fetchAdminJson(`/api/admin/files/${encodeURIComponent(fileId)}`, signal);
  const parsed = adminFileDetailResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('Admin file detail response validation failed.');
  return parsed.data;
}

async function fetchAdminDownloads(
  fileId: string | null,
  page: number,
  signal?: AbortSignal
): Promise<AdminDownloadListResponse> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(DOWNLOAD_PAGE_SIZE)
  });
  if (fileId) params.set('fileId', fileId);
  const body = await fetchAdminJson(`/api/admin/downloads?${params.toString()}`, signal);
  const parsed = adminDownloadListResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('Admin downloads response validation failed.');
  return parsed.data;
}

async function loadDashboardState(signal?: AbortSignal): Promise<DashboardState> {
  const sessionResponse = await fetchAdminSession(signal);

  if (!sessionResponse.authenticated || !sessionResponse.session) {
    return { kind: 'unauthenticated' };
  }

  const [statsResponse, overviewResponse, anomaliesResponse, reportsResponse] = await Promise.all([
    fetchAdminStats(signal),
    fetchAdminOverview(signal),
    fetchAdminAnomalies(signal),
    fetchAdminReports('pending', 1, null, null, signal)
  ]);

  return {
    kind: 'ready',
    session: sessionResponse.session,
    stats: statsResponse,
    overview: overviewResponse,
    anomalies: anomaliesResponse.anomalies,
    reports: reportsResponse.reports,
    reportsTotal: reportsResponse.total,
    refreshedAt: new Date().toISOString()
  };
}

// ─── Formatters ──────────────────────────────────────────────────────────────

function formatDateTime(value: string): string {
  return dateTimeFormatter.format(new Date(value));
}

function formatLag(lagMs: number): string {
  if (lagMs < 1_000) return `${lagMs} ms`;
  if (lagMs < 60_000) return `${(lagMs / 1_000).toFixed(1)} s`;
  return `${(lagMs / 60_000).toFixed(1)} min`;
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return 'n/a';
  return formatLag(durationMs);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${formatCount(value)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = -1;
  do {
    size /= 1024;
    unitIndex += 1;
  } while (size >= 1024 && unitIndex < units.length - 1);
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: size >= 100 ? 0 : 1 }).format(size)} ${units[unitIndex]}`;
}

function formatOptionalDateTime(value: string | null): string {
  return value ? formatDateTime(value) : 'n/a';
}

function formatAnomalyType(type: OperationalAnomalySummary['type']): string {
  return type.replaceAll('_', ' ');
}

function formatReportReason(reason: AdminReportSummary['reason']): string {
  return reason.replaceAll('_', ' ');
}

function formatReportUrgency(urgency: AdminReportSummary['urgency']): string {
  return urgency[0]?.toUpperCase() + urgency.slice(1);
}

function formatFileStatus(status: AdminFileSummary['status']): string {
  return status.replaceAll('_', ' ');
}

function formatModerationTransition(previousStatus: string, nextStatus: string): string {
  return `${formatFileStatus(previousStatus as AdminFileSummary['status'])} → ${formatFileStatus(nextStatus as AdminFileSummary['status'])}`;
}

function formatStorageObjectStatus(status: AdminFileDetail['storageObject']['status']): string {
  switch (status) {
    case 'present':
      return 'Present';
    case 'missing':
      return 'Missing';
    case 'unknown':
      return 'Check failed';
  }
}

function summarizeQueueState(queue: QueueHealthSnapshot): string {
  if (queue.status === 'degraded') return 'Degraded';
  if (queue.failed > 0) return 'Needs attention';
  if (queue.active > 0 || queue.waiting > 0) return 'Working';
  if (queue.delayed > 0) return 'Scheduled';
  return 'Idle';
}

function formatDetailValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return 'n/a';
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

// ─── Components ──────────────────────────────────────────────────────────────

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
      </div>
    </article>
  );
}

// ─── Tab: Overview ───────────────────────────────────────────────────────────

function OverviewTab({ data }: { data: DashboardData }) {
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

// ─── Tab: Files ──────────────────────────────────────────────────────────────

const FILE_STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'expiring', label: 'Expiring' },
  { value: 'expired', label: 'Expired' },
  { value: 'hidden', label: 'Hidden' },
  { value: 'deleted', label: 'Deleted' },
  { value: 'consumed', label: 'Consumed' }
] as const;

const FILE_SORT_OPTIONS = [
  { value: 'uploadedAt_desc', label: 'Latest' },
  { value: 'sizeBytes_desc', label: 'Largest' },
  { value: 'reportCount_desc', label: 'Most reported' }
] as const;

const FILE_POLICY_FILTERS = [
  { value: '', label: 'Any policy' },
  { value: 'standard', label: 'Standard' },
  { value: 'one_time', label: 'One-time' },
  { value: 'preview_enabled', label: 'Preview enabled' }
] as const;

const FILE_DATE_FILTERS = [
  { value: '', label: 'Any time' },
  { value: 1, label: '24h' },
  { value: 7, label: '7d' },
  { value: 30, label: '30d' }
] as const;

const FILE_REPORT_VOLUME_FILTERS = [
  { value: '', label: 'Any reports' },
  { value: 1, label: '1+ reports' },
  { value: 3, label: '3+ reports' }
] as const;

function FilesTab({
  onInspect,
  onModerate,
  onAccessLost
}: {
  onInspect: (fileId: string) => void;
  onModerate: (fileId: string, action: 'hide' | 'restore' | 'delete') => Promise<void>;
  onAccessLost: OnAdminAccessLost;
}) {
  const requestTracker = useRequestTracker();
  const [files, setFiles] = useState<AdminFileSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [policyFilter, setPolicyFilter] = useState<
    '' | 'standard' | 'one_time' | 'preview_enabled'
  >('');
  const [sortBy, setSortBy] = useState<'uploadedAt_desc' | 'sizeBytes_desc' | 'reportCount_desc'>(
    'uploadedAt_desc'
  );
  const [uploadedWithinDays, setUploadedWithinDays] = useState<number | null>(null);
  const [minReportCount, setMinReportCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const loadFiles = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    await runTrackedRequest({
      tracker: requestTracker,
      run: () =>
        fetchAdminFiles(
          statusFilter || null,
          policyFilter || null,
          sortBy,
          uploadedWithinDays,
          minReportCount,
          page
        ),
      onSuccess: (res) => {
        setFiles(res.files);
        setTotal(res.total);
      },
      onError: (err: unknown) => {
        if (err instanceof AdminAccessError) {
          onAccessLost(err);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load files.');
      },
      onFinally: () => setIsLoading(false)
    });
  }, [
    minReportCount,
    onAccessLost,
    page,
    policyFilter,
    requestTracker,
    sortBy,
    statusFilter,
    uploadedWithinDays
  ]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  const handleModerate = async (
    fileId: string,
    action: 'hide' | 'restore' | 'delete',
    targetLabel: string
  ) => {
    if (!confirmModerationAction(action, targetLabel)) {
      return;
    }

    setPendingAction(fileId);
    try {
      await onModerate(fileId, action);
      void loadFiles();
    } catch (err: unknown) {
      if (err instanceof AdminAccessError) {
        onAccessLost(err);
        return;
      }
      setError(err instanceof Error ? err.message : 'Moderation action failed.');
    } finally {
      setPendingAction(null);
    }
  };

  const totalPages = Math.ceil(total / FILE_PAGE_SIZE);

  return (
    <section className="panel">
      <div className="panel__row">
        <p className="panel__label">Files</p>
        <span className="chip chip--outline">{formatCount(total)} total</span>
      </div>

      <div className="admin-nav">
        {FILE_STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            className={`admin-nav__tab ${statusFilter === f.value ? 'admin-nav__tab--active' : ''}`}
            onClick={() => {
              setPage(1);
              setStatusFilter(f.value);
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <nav className="admin-nav" aria-label="Sort files by">
        {FILE_SORT_OPTIONS.map((s) => (
          <button
            key={s.value}
            type="button"
            className={`admin-nav__tab admin-nav__tab--sm ${sortBy === s.value ? 'admin-nav__tab--active' : ''}`}
            onClick={() => {
              setPage(1);
              setSortBy(s.value);
            }}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <nav className="admin-nav" aria-label="Filter files by policy">
        {FILE_POLICY_FILTERS.map((option) => (
          <button
            key={option.label}
            type="button"
            className={`admin-nav__tab admin-nav__tab--sm ${policyFilter === option.value ? 'admin-nav__tab--active' : ''}`}
            onClick={() => {
              setPage(1);
              setPolicyFilter(option.value);
            }}
          >
            {option.label}
          </button>
        ))}
      </nav>

      <nav className="admin-nav" aria-label="Filter files by upload date">
        {FILE_DATE_FILTERS.map((option) => (
          <button
            key={option.label}
            type="button"
            className={`admin-nav__tab admin-nav__tab--sm ${uploadedWithinDays === (option.value || null) ? 'admin-nav__tab--active' : ''}`}
            onClick={() => {
              setPage(1);
              setUploadedWithinDays(option.value || null);
            }}
          >
            {option.label}
          </button>
        ))}
      </nav>

      <nav className="admin-nav" aria-label="Filter files by report volume">
        {FILE_REPORT_VOLUME_FILTERS.map((option) => (
          <button
            key={option.label}
            type="button"
            className={`admin-nav__tab admin-nav__tab--sm ${minReportCount === (option.value || null) ? 'admin-nav__tab--active' : ''}`}
            onClick={() => {
              setPage(1);
              setMinReportCount(option.value || null);
            }}
          >
            {option.label}
          </button>
        ))}
      </nav>

      {error ? <p className="upload-error">{error}</p> : null}

      {isLoading ? (
        <div className="state-empty">
          <strong>Loading files…</strong>
        </div>
      ) : files.length === 0 ? (
        <div className="state-empty">
          <strong>No files match this filter.</strong>
        </div>
      ) : (
        <div className="report-queue">
          {files.map((file) => (
            <article key={file.id} className="report-card">
              <div className="report-card__header">
                <div>
                  <p className="surface-card__index">{formatFileStatus(file.status)}</p>
                  <h2>{file.sanitizedFilename}</h2>
                </div>
                <span className="chip chip--outline">{formatBytes(file.sizeBytes)}</span>
              </div>
              <p className="panel__copy report-card__meta">
                {file.mimeType} · {file.reportCount > 0 ? `${file.reportCount} reports · ` : ''}
                {file.oneTimeDownload ? 'one-time · ' : ''}
                uploaded {formatDateTime(file.uploadedAt)}
                {file.expiresAt ? ` · expires ${formatDateTime(file.expiresAt)}` : ''}
              </p>
              <div className="report-card__actions">
                {canHideFileStatus(file.status) ? (
                  <button
                    type="button"
                    className="button-link button-link--ghost button-link--sm"
                    disabled={pendingAction === file.id}
                    onClick={() => handleModerate(file.id, 'hide', file.sanitizedFilename)}
                  >
                    {pendingAction === file.id ? 'Saving…' : 'Hide'}
                  </button>
                ) : null}
                {file.status === 'hidden' ? (
                  <button
                    type="button"
                    className="button-link button-link--sm"
                    disabled={pendingAction === file.id}
                    onClick={() => handleModerate(file.id, 'restore', file.sanitizedFilename)}
                  >
                    {pendingAction === file.id ? 'Saving…' : 'Restore'}
                  </button>
                ) : null}
                {file.status !== 'deleted' ? (
                  <button
                    type="button"
                    className="button-link button-link--ghost button-link--sm"
                    disabled={pendingAction === file.id}
                    onClick={() => handleModerate(file.id, 'delete', file.sanitizedFilename)}
                  >
                    Delete
                  </button>
                ) : null}
                <button
                  type="button"
                  className="button-link button-link--ghost button-link--sm"
                  onClick={() => onInspect(file.id)}
                >
                  Inspect
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="report-card__actions" style={{ marginTop: 14 }}>
          <button
            type="button"
            className="button-link button-link--ghost button-link--sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ← Previous
          </button>
          <span className="chip chip--outline">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="button-link button-link--ghost button-link--sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </div>
      ) : null}
    </section>
  );
}

// ─── Tab: Reports ────────────────────────────────────────────────────────────

const REPORT_STATUS_FILTERS = [
  { value: 'pending', label: 'Pending' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'dismissed', label: 'Dismissed' }
] as const;

const REPORT_REASON_FILTERS = [
  { value: '', label: 'Any reason' },
  { value: 'illegal_content', label: 'Illegal content' },
  { value: 'copyright_violation', label: 'Copyright' },
  { value: 'malware', label: 'Malware' },
  { value: 'spam', label: 'Spam' },
  { value: 'other', label: 'Other' }
] as const;

const REPORT_URGENCY_FILTERS = [
  { value: '', label: 'Any urgency' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' }
] as const;

function ReportsTab({
  onInspect,
  onModerateFile,
  onAccessLost
}: {
  onInspect: (fileId: string) => void;
  onModerateFile: (fileId: string, action: 'hide' | 'restore' | 'delete') => Promise<void>;
  onAccessLost: OnAdminAccessLost;
}) {
  const requestTracker = useRequestTracker();
  const [reports, setReports] = useState<AdminReportSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [reasonFilter, setReasonFilter] = useState<
    '' | 'illegal_content' | 'copyright_violation' | 'malware' | 'spam' | 'other'
  >('');
  const [urgencyFilter, setUrgencyFilter] = useState<'' | 'high' | 'medium' | 'low'>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    await runTrackedRequest({
      tracker: requestTracker,
      run: () => fetchAdminReports(statusFilter, page, reasonFilter || null, urgencyFilter || null),
      onSuccess: (res) => {
        setReports(res.reports);
        setTotal(res.total);
      },
      onError: (err: unknown) => {
        if (err instanceof AdminAccessError) {
          onAccessLost(err);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load reports.');
      },
      onFinally: () => setIsLoading(false)
    });
  }, [onAccessLost, page, reasonFilter, requestTracker, statusFilter, urgencyFilter]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const resolveReport = async (reportId: string, action: 'resolved' | 'dismissed') => {
    setPendingAction(reportId);
    try {
      const result = await postAdminJson(
        `/api/admin/reports/${encodeURIComponent(reportId)}/resolve`,
        { action }
      );
      if (!result.ok) {
        throw new Error(extractErrorMessage(result.body, 'Failed to resolve report.'));
      }
      void loadReports();
    } catch (err: unknown) {
      if (err instanceof AdminAccessError) {
        onAccessLost(err);
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to resolve report.');
    } finally {
      setPendingAction(null);
    }
  };

  const handleModerateFile = async (fileId: string, action: 'hide' | 'restore' | 'delete') => {
    if (!confirmModerationAction(action, `file ${fileId.slice(0, 8)}`)) {
      return;
    }

    setPendingAction(fileId);
    try {
      await onModerateFile(fileId, action);
      void loadReports();
    } catch (err: unknown) {
      if (err instanceof AdminAccessError) {
        onAccessLost(err);
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to moderate file.');
    } finally {
      setPendingAction(null);
    }
  };

  const totalPages = Math.ceil(total / REPORT_PAGE_SIZE);

  return (
    <section className="panel">
      <div className="panel__row">
        <p className="panel__label">Reports</p>
        <span className="chip chip--outline">
          {formatCount(total)} {statusFilter}
        </span>
      </div>

      <div className="admin-nav">
        {REPORT_STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            className={`admin-nav__tab ${statusFilter === f.value ? 'admin-nav__tab--active' : ''}`}
            onClick={() => {
              setPage(1);
              setStatusFilter(f.value);
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <nav className="admin-nav" aria-label="Filter reports by reason">
        {REPORT_REASON_FILTERS.map((option) => (
          <button
            key={option.label}
            type="button"
            className={`admin-nav__tab admin-nav__tab--sm ${reasonFilter === option.value ? 'admin-nav__tab--active' : ''}`}
            onClick={() => {
              setPage(1);
              setReasonFilter(option.value);
            }}
          >
            {option.label}
          </button>
        ))}
      </nav>

      <nav className="admin-nav" aria-label="Filter reports by urgency">
        {REPORT_URGENCY_FILTERS.map((option) => (
          <button
            key={option.label}
            type="button"
            className={`admin-nav__tab admin-nav__tab--sm ${urgencyFilter === option.value ? 'admin-nav__tab--active' : ''}`}
            onClick={() => {
              setPage(1);
              setUrgencyFilter(option.value);
            }}
          >
            {option.label}
          </button>
        ))}
      </nav>

      {error ? <p className="upload-error">{error}</p> : null}

      {isLoading ? (
        <div className="state-empty">
          <strong>Loading reports…</strong>
        </div>
      ) : reports.length === 0 ? (
        <div className="state-empty">
          <strong>No {statusFilter} reports.</strong>
        </div>
      ) : (
        <div className="report-queue">
          {reports.map((report) => (
            <article key={report.id} className="report-card">
              <div className="report-card__header">
                <div>
                  <p className="surface-card__index">{formatReportReason(report.reason)}</p>
                  <h2>File {report.fileId.slice(0, 8)}</h2>
                </div>
                <div className="report-card__chips">
                  <span className={`chip chip--severity chip--severity-${report.urgency}`}>
                    {formatReportUrgency(report.urgency)}
                  </span>
                  <span className="chip chip--outline">{formatDateTime(report.createdAt)}</span>
                </div>
              </div>
              <p className="panel__copy report-card__message">
                {report.message?.trim() || 'No additional context provided.'}
              </p>
              {report.resolvedBy ? (
                <p className="panel__copy report-card__meta">
                  {report.status} by {report.resolvedBy}
                  {report.resolvedAt ? ` at ${formatDateTime(report.resolvedAt)}` : ''}
                </p>
              ) : null}
              <div className="report-card__actions">
                {report.status === 'pending' ? (
                  <>
                    <button
                      type="button"
                      className="button-link button-link--sm"
                      disabled={pendingAction === report.id}
                      onClick={() => resolveReport(report.id, 'resolved')}
                    >
                      {pendingAction === report.id ? 'Saving…' : 'Resolve'}
                    </button>
                    <button
                      type="button"
                      className="button-link button-link--ghost button-link--sm"
                      disabled={pendingAction === report.id}
                      onClick={() => resolveReport(report.id, 'dismissed')}
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      className="button-link button-link--ghost button-link--sm"
                      disabled={pendingAction === report.fileId}
                      onClick={() => handleModerateFile(report.fileId, 'hide')}
                    >
                      Hide file
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="button-link button-link--ghost button-link--sm"
                  onClick={() => onInspect(report.fileId)}
                >
                  Inspect file
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="report-card__actions" style={{ marginTop: 14 }}>
          <button
            type="button"
            className="button-link button-link--ghost button-link--sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ← Previous
          </button>
          <span className="chip chip--outline">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="button-link button-link--ghost button-link--sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </div>
      ) : null}
    </section>
  );
}

// ─── Tab: Downloads ──────────────────────────────────────────────────────────

function DownloadsTab({
  onInspect,
  onAccessLost
}: {
  onInspect: (fileId: string) => void;
  onAccessLost: OnAdminAccessLost;
}) {
  const requestTracker = useRequestTracker();
  const [downloads, setDownloads] = useState<AdminDownloadListResponse['downloads']>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [fileIdFilter, setFileIdFilter] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    void runTrackedRequest({
      tracker: requestTracker,
      run: () => fetchAdminDownloads(fileIdFilter || null, page),
      onSuccess: (res) => {
        setDownloads(res.downloads);
        setTotal(res.total);
      },
      onError: (err: unknown) => {
        if (err instanceof AdminAccessError) {
          onAccessLost(err);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load downloads.');
      },
      onFinally: () => setIsLoading(false)
    });
  }, [fileIdFilter, onAccessLost, page, requestTracker]);

  const totalPages = Math.ceil(total / DOWNLOAD_PAGE_SIZE);

  return (
    <section className="panel">
      <div className="panel__row">
        <p className="panel__label">Download activity</p>
        <span className="chip chip--outline">{formatCount(total)} events</span>
      </div>

      {error ? <p className="upload-error">{error}</p> : null}

      {isLoading ? (
        <div className="state-empty">
          <strong>Loading download events…</strong>
        </div>
      ) : downloads.length === 0 ? (
        <div className="state-empty">
          <strong>No download events recorded yet.</strong>
        </div>
      ) : (
        <div className="report-queue">
          {downloads.map((dl) => (
            <article key={dl.id} className="report-card report-card--compact">
              <div className="report-card__header">
                <div>
                  <p className="surface-card__index">{dl.eventType}</p>
                  <h2>File {dl.fileId.slice(0, 8)}</h2>
                </div>
                <span className="chip chip--outline">{formatDateTime(dl.createdAt)}</span>
              </div>
              <div className="report-card__actions">
                <button
                  type="button"
                  className="button-link button-link--ghost button-link--sm"
                  onClick={() => onInspect(dl.fileId)}
                >
                  Inspect file
                </button>
                <button
                  type="button"
                  className="button-link button-link--ghost button-link--sm"
                  onClick={() => {
                    setFileIdFilter(dl.fileId);
                    setPage(1);
                  }}
                >
                  Filter by file
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {fileIdFilter ? (
        <div className="report-card__actions" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="button-link button-link--ghost button-link--sm"
            onClick={() => {
              setFileIdFilter('');
              setPage(1);
            }}
          >
            Clear file filter
          </button>
          <span className="chip chip--outline">Filtered: {fileIdFilter.slice(0, 8)}…</span>
        </div>
      ) : null}

      {totalPages > 1 ? (
        <div className="report-card__actions" style={{ marginTop: 14 }}>
          <button
            type="button"
            className="button-link button-link--ghost button-link--sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ← Previous
          </button>
          <span className="chip chip--outline">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="button-link button-link--ghost button-link--sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </div>
      ) : null}
    </section>
  );
}

// ─── Tab: Storage ────────────────────────────────────────────────────────────

function StorageTab({
  data,
  onInspect,
  onAccessLost
}: {
  data: DashboardData;
  onInspect: (fileId: string) => void;
  onAccessLost: OnAdminAccessLost;
}) {
  const requestTracker = useRequestTracker();
  const [files, setFiles] = useState<AdminFileSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    void runTrackedRequest({
      tracker: requestTracker,
      run: () => fetchAdminFiles(null, null, 'sizeBytes_desc', null, null, page),
      onSuccess: (res) => {
        setFiles(res.files);
        setTotal(res.total);
      },
      onError: (err: unknown) => {
        if (err instanceof AdminAccessError) {
          onAccessLost(err);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load storage view.');
      },
      onFinally: () => setIsLoading(false)
    });
  }, [onAccessLost, page, requestTracker]);

  const highlights = buildStorageHighlights(data.overview, files);
  const totalPages = Math.ceil(total / FILE_PAGE_SIZE);

  return (
    <section className="panel">
      <div className="panel__row">
        <p className="panel__label">Storage</p>
        <span className="chip chip--outline">Largest files first</span>
      </div>

      <div className="metric-grid">
        <article className="metric-card">
          <p className="surface-card__index">Total storage</p>
          <strong className="metric-card__value">
            {formatBytes(highlights.totalStorageBytes)}
          </strong>
          <p className="metric-card__meta">Current object volume tracked in metadata.</p>
        </article>
        <article className="metric-card">
          <p className="surface-card__index">Publicly available</p>
          <strong className="metric-card__value">{formatCount(highlights.activeFileCount)}</strong>
          <p className="metric-card__meta">Active and expiring files still reachable by link.</p>
        </article>
        <article className="metric-card">
          <p className="surface-card__index">Non-public</p>
          <strong className="metric-card__value">
            {formatCount(highlights.nonPublicFileCount)}
          </strong>
          <p className="metric-card__meta">
            Hidden, deleted, expired, or consumed files awaiting cleanup or review.
          </p>
        </article>
        <article className="metric-card">
          <p className="surface-card__index">Largest object loaded</p>
          <strong className="metric-card__value">
            {highlights.largestFile ? formatBytes(highlights.largestFile.sizeBytes) : 'n/a'}
          </strong>
          <p className="metric-card__meta">
            {highlights.largestFile
              ? highlights.largestFile.sanitizedFilename
              : 'Load ranked files to inspect the heaviest object.'}
          </p>
        </article>
      </div>

      <div className="panel__row" style={{ marginTop: 20 }}>
        <p className="panel__label">Largest files</p>
        <span className="chip chip--outline">{formatCount(total)} tracked</span>
      </div>

      {error ? <p className="upload-error">{error}</p> : null}

      {isLoading ? (
        <div className="state-empty">
          <strong>Loading storage rankings…</strong>
        </div>
      ) : files.length === 0 ? (
        <div className="state-empty">
          <strong>No files available for storage ranking.</strong>
        </div>
      ) : (
        <div className="report-queue">
          {files.map((file) => (
            <article key={file.id} className="report-card">
              <div className="report-card__header">
                <div>
                  <p className="surface-card__index">{formatFileStatus(file.status)}</p>
                  <h2>{file.sanitizedFilename}</h2>
                </div>
                <span className="chip chip--outline">{formatBytes(file.sizeBytes)}</span>
              </div>
              <p className="panel__copy report-card__meta">
                {file.mimeType} · {file.reportCount} reports · uploaded{' '}
                {formatDateTime(file.uploadedAt)}
              </p>
              <div className="report-card__actions">
                <button
                  type="button"
                  className="button-link button-link--ghost button-link--sm"
                  onClick={() => onInspect(file.id)}
                >
                  Inspect file
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="report-card__actions" style={{ marginTop: 14 }}>
          <button
            type="button"
            className="button-link button-link--ghost button-link--sm"
            disabled={page <= 1}
            onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
          >
            ← Previous
          </button>
          <span className="chip chip--outline">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="button-link button-link--ghost button-link--sm"
            disabled={page >= totalPages}
            onClick={() => setPage((currentPage) => currentPage + 1)}
          >
            Next →
          </button>
        </div>
      ) : null}
    </section>
  );
}

// ─── Tab: Queues ─────────────────────────────────────────────────────────────

function QueuesTab({ data }: { data: DashboardData }) {
  return (
    <section className="panel">
      <div className="panel__row">
        <p className="panel__label">Queue health</p>
        <span className="chip chip--outline">{data.stats.queueHealth.length} queues</span>
      </div>
      <div className="surface-grid surface-grid--narrow admin-queue-grid">
        {data.stats.queueHealth.map((queue) => (
          <QueueCard key={queue.queue} queue={queue} />
        ))}
      </div>
    </section>
  );
}

// ─── Tab: Anomalies ──────────────────────────────────────────────────────────

function AnomaliesTab({ data }: { data: DashboardData }) {
  return (
    <section className="panel">
      <div className="panel__row">
        <p className="panel__label">Anomaly backlog</p>
        <span className="chip chip--outline">
          {data.anomalies.length === 0 ? 'Clear' : `${data.anomalies.length} visible`}
        </span>
      </div>

      {data.anomalies.length === 0 ? (
        <div className="state-empty">
          <strong>No unresolved lifecycle anomalies.</strong>
          <p className="panel__copy">
            Reconciliation is not reporting any open storage or expiration mismatches right now.
          </p>
        </div>
      ) : (
        <div className="anomaly-list">
          {data.anomalies.map((anomaly) => (
            <article key={anomaly.id} className="anomaly-card">
              <div className="anomaly-card__header">
                <div>
                  <p className="surface-card__index">{formatAnomalyType(anomaly.type)}</p>
                  <h2>
                    {anomaly.fileId ? `File ${anomaly.fileId.slice(0, 8)}` : 'Storage-only anomaly'}
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
  );
}

// ─── File Inspection Panel ───────────────────────────────────────────────────

function FileInspection({
  fileId,
  onClose,
  onModerate,
  onAccessLost
}: {
  fileId: string;
  onClose: () => void;
  onModerate: (fileId: string, action: 'hide' | 'restore' | 'delete') => Promise<void>;
  onAccessLost: OnAdminAccessLost;
}) {
  const requestTracker = useRequestTracker();
  const [detail, setDetail] = useState<AdminFileDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    await runTrackedRequest({
      tracker: requestTracker,
      run: () => fetchAdminFileDetail(fileId),
      onSuccess: (res) => setDetail(res.file),
      onError: (err: unknown) => {
        if (err instanceof AdminAccessError) {
          onAccessLost(err);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load file detail.');
      },
      onFinally: () => setIsLoading(false)
    });
  }, [fileId, onAccessLost, requestTracker]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const handleModerate = async (action: 'hide' | 'restore' | 'delete') => {
    if (!confirmModerationAction(action, detail?.sanitizedFilename ?? 'this file')) {
      return;
    }

    setPendingAction(action);
    try {
      await onModerate(fileId, action);
      void loadDetail();
    } catch (err: unknown) {
      if (err instanceof AdminAccessError) {
        onAccessLost(err);
        return;
      }
      setError(err instanceof Error ? err.message : 'Moderation action failed.');
    } finally {
      setPendingAction(null);
    }
  };

  if (isLoading) {
    return (
      <section className="panel panel--feature">
        <div className="panel__row">
          <p className="panel__label">File inspection</p>
          <button
            type="button"
            className="button-link button-link--ghost button-link--sm"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="state-empty">
          <strong>Loading file detail…</strong>
        </div>
      </section>
    );
  }

  if (error || !detail) {
    return (
      <section className="panel panel--feature">
        <div className="panel__row">
          <p className="panel__label">File inspection</p>
          <button
            type="button"
            className="button-link button-link--ghost button-link--sm"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="state-empty">
          <strong>Failed to load file.</strong>
          <p className="panel__copy">{error ?? 'Unknown error'}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel panel--feature">
      <div className="panel__row">
        <p className="panel__label">File inspection</p>
        <div className="report-card__chips">
          <span className="chip chip--outline">{formatFileStatus(detail.status)}</span>
          <button
            type="button"
            className="button-link button-link--ghost button-link--sm"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>

      <div className="admin-detail-stack">
        <article className="report-card report-card--selected">
          <div className="report-card__header">
            <div>
              <p className="surface-card__index">{detail.sanitizedFilename}</p>
              <h2>{formatFileStatus(detail.status)}</h2>
            </div>
            <span className="chip chip--outline">{formatCount(detail.reportCount)} reports</span>
          </div>

          <div className="admin-detail-grid">
            <div className="queue-card__stat">
              <span>Share token</span>
              <strong>{detail.token}</strong>
            </div>
            <div className="queue-card__stat">
              <span>MIME type</span>
              <strong>{detail.mimeType}</strong>
            </div>
            <div className="queue-card__stat">
              <span>Size</span>
              <strong>{formatBytes(detail.sizeBytes)}</strong>
            </div>
            <div className="queue-card__stat">
              <span>Uploaded</span>
              <strong>{formatDateTime(detail.uploadedAt)}</strong>
            </div>
            <div className="queue-card__stat">
              <span>Activated</span>
              <strong>{formatOptionalDateTime(detail.activatedAt)}</strong>
            </div>
            <div className="queue-card__stat">
              <span>Expires</span>
              <strong>{formatOptionalDateTime(detail.expiresAt)}</strong>
            </div>
            <div className="queue-card__stat">
              <span>Preview</span>
              <strong>{detail.allowPreview ? 'Allowed' : 'Blocked'}</strong>
            </div>
            <div className="queue-card__stat">
              <span>One-time</span>
              <strong>{detail.oneTimeDownload ? 'Enabled' : 'Disabled'}</strong>
            </div>
            <div className="queue-card__stat">
              <span>Storage object</span>
              <strong>{formatStorageObjectStatus(detail.storageObject.status)}</strong>
            </div>
            <div className="queue-card__stat">
              <span>Stored bytes</span>
              <strong>
                {detail.storageObject.contentLength === null
                  ? 'n/a'
                  : formatBytes(detail.storageObject.contentLength)}
              </strong>
            </div>
            <div className="queue-card__stat">
              <span>Consumed</span>
              <strong>{formatOptionalDateTime(detail.consumedAt)}</strong>
            </div>
            <div className="queue-card__stat">
              <span>Deleted</span>
              <strong>{formatOptionalDateTime(detail.deletedAt)}</strong>
            </div>
            <div className="queue-card__stat">
              <span>Storage check</span>
              <strong>{formatDateTime(detail.storageObject.checkedAt)}</strong>
            </div>
          </div>

          {detail.storageObject.error ? (
            <p className="panel__copy report-card__meta">
              Storage inspection degraded: {detail.storageObject.error}
            </p>
          ) : null}

          <div className="report-card__actions">
            {canHideFileStatus(detail.status) ? (
              <button
                type="button"
                className="button-link button-link--ghost button-link--sm"
                disabled={pendingAction !== null}
                onClick={() => handleModerate('hide')}
              >
                {pendingAction === 'hide' ? 'Saving…' : 'Hide'}
              </button>
            ) : null}
            {detail.status === 'hidden' ? (
              <button
                type="button"
                className="button-link button-link--sm"
                disabled={pendingAction !== null}
                onClick={() => handleModerate('restore')}
              >
                {pendingAction === 'restore' ? 'Saving…' : 'Restore'}
              </button>
            ) : null}
            {detail.status !== 'deleted' ? (
              <button
                type="button"
                className="button-link button-link--ghost button-link--sm"
                disabled={pendingAction !== null}
                onClick={() => handleModerate('delete')}
              >
                {pendingAction === 'delete' ? 'Saving…' : 'Delete'}
              </button>
            ) : null}
          </div>
        </article>

        <div className="admin-detail-grid admin-detail-grid--columns">
          <article className="report-card admin-detail-panel">
            <div className="report-card__header">
              <div>
                <p className="surface-card__index">Download activity</p>
                <h2>{formatCount(detail.downloadActivity.total)} events</h2>
              </div>
            </div>
            {detail.downloadActivity.recent.length === 0 ? (
              <div className="state-empty">
                <strong>No download events for this file yet.</strong>
              </div>
            ) : (
              <div className="admin-detail-list">
                {detail.downloadActivity.recent.map((event) => (
                  <article key={event.id} className="report-card report-card--compact">
                    <div className="report-card__header">
                      <div>
                        <p className="surface-card__index">{event.eventType}</p>
                        <h2>{formatDateTime(event.createdAt)}</h2>
                      </div>
                      <span className="chip chip--outline">
                        {event.ipHash ? `${event.ipHash.slice(0, 8)}…` : 'no IP hash'}
                      </span>
                    </div>
                    <dl className="detail-pairs">
                      <div className="detail-pairs__row">
                        <dt>File</dt>
                        <dd>{event.fileId}</dd>
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
                <p className="surface-card__index">Report trail</p>
                <h2>{formatCount(detail.reports.length)} reports</h2>
              </div>
            </div>
            {detail.reports.length === 0 ? (
              <div className="state-empty">
                <strong>No reports for this file.</strong>
              </div>
            ) : (
              <div className="admin-detail-list">
                {detail.reports.map((report) => (
                  <article key={report.id} className="report-card report-card--compact">
                    <div className="report-card__header">
                      <div>
                        <p className="surface-card__index">{formatReportReason(report.reason)}</p>
                        <h2>{report.status}</h2>
                      </div>
                      <div className="report-card__chips">
                        <span className={`chip chip--severity chip--severity-${report.urgency}`}>
                          {formatReportUrgency(report.urgency)}
                        </span>
                        <span className="chip chip--outline">
                          {formatDateTime(report.createdAt)}
                        </span>
                      </div>
                    </div>
                    <p className="panel__copy report-card__message">
                      {report.message?.trim() || 'No additional context.'}
                    </p>
                    <dl className="detail-pairs">
                      <div className="detail-pairs__row">
                        <dt>Resolved by</dt>
                        <dd>{report.resolvedBy ?? 'Pending'}</dd>
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
                <h2>{formatCount(detail.moderationHistory.length)} actions</h2>
              </div>
            </div>
            {detail.moderationHistory.length === 0 ? (
              <div className="state-empty">
                <strong>No moderation actions recorded.</strong>
              </div>
            ) : (
              <div className="admin-detail-list">
                {detail.moderationHistory.map((entry) => (
                  <article key={entry.id} className="report-card report-card--compact">
                    <div className="report-card__header">
                      <div>
                        <p className="surface-card__index">{entry.action}</p>
                        <h2>
                          {formatModerationTransition(entry.previousStatus, entry.nextStatus)}
                        </h2>
                      </div>
                      <span className="chip chip--outline">{formatDateTime(entry.createdAt)}</span>
                    </div>
                    <dl className="detail-pairs">
                      <div className="detail-pairs__row">
                        <dt>Actor</dt>
                        <dd>{entry.actorGithubLogin}</dd>
                      </div>
                      <div className="detail-pairs__row">
                        <dt>Reason</dt>
                        <dd>{entry.reason ?? 'No note.'}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            )}
          </article>
        </div>
      </div>
    </section>
  );
}

// ─── Admin Rail ──────────────────────────────────────────────────────────────

function AdminRail({ state, onLogout }: { state: DashboardState; onLogout: () => void }) {
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
            <div className="status-item">
              <button
                type="button"
                className="button-link button-link--ghost button-link--sm"
                onClick={onLogout}
              >
                Sign out
              </button>
            </div>
          </div>
        ) : (
          <p className="panel__copy">Sign in with GitHub to access the operations dashboard.</p>
        )}
      </section>
    </>
  );
}

// ─── Main Page Component ─────────────────────────────────────────────────────

function AdminPage() {
  const requestTracker = useRequestTracker();
  const [state, setState] = useState<DashboardState>({ kind: 'loading' });
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [inspectedFileId, setInspectedFileId] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Parse ?error= from URL (OAuth callback errors)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorParam = params.get('error');
    if (errorParam) {
      setLoginError(
        errorParam === 'not_allowlisted'
          ? 'This GitHub account is not authorized to access the admin dashboard.'
          : errorParam === 'state_expired'
            ? 'Login session expired. Please try again.'
            : `Login failed: ${errorParam.replaceAll('_', ' ')}`
      );
      // Clean URL
      window.history.replaceState({}, '', '/admin');
    }
  }, []);

  const handleAccessLost = useCallback((error: AdminAccessError) => {
    setInspectedFileId(null);
    setActiveTab('overview');
    setState({
      kind: 'unauthenticated',
      error: getAdminAccessErrorMessage(error.reason)
    });
  }, []);

  useEffect(() => {
    if (refreshKey === 0) {
      setState({ kind: 'loading' });
    } else {
      setIsRefreshing(true);
    }

    void runTrackedRequest({
      tracker: requestTracker,
      run: () => loadDashboardState(),
      onSuccess: (nextState) => setState(nextState),
      onError: (error: unknown) => {
        if (error instanceof AdminAccessError) {
          handleAccessLost(error);
          return;
        }
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Failed to load dashboard.'
        });
      },
      onFinally: () => setIsRefreshing(false)
    });
  }, [handleAccessLost, refreshKey, requestTracker]);

  const refresh = () => setRefreshKey((k) => k + 1);

  const handleLogin = async () => {
    try {
      setLoginError(null);
      const body = await fetchAdminJson('/api/admin/auth/login');
      const result = body as { authorizationUrl: string };
      if (result.authorizationUrl) {
        window.location.href = result.authorizationUrl;
      }
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Failed to start login.');
    }
  };

  const handleLogout = async () => {
    try {
      await postAdminJson('/api/admin/auth/logout', {});
    } catch {
      // Proceed with local logout even if server fails
    }
    setState({ kind: 'unauthenticated' });
    setActiveTab('overview');
  };

  const moderateFile = async (fileId: string, action: 'hide' | 'restore' | 'delete') => {
    const result = await postAdminJson(`/api/admin/files/${encodeURIComponent(fileId)}/moderate`, {
      action
    });
    if (!result.ok) {
      throw new Error(extractErrorMessage(result.body, 'Moderation action failed.'));
    }
  };

  const openInspection = (fileId: string) => {
    setInspectedFileId(fileId);
  };

  const unauthenticatedMessage =
    state.kind === 'unauthenticated' ? (state.error ?? loginError) : loginError;

  const pendingReportsCount = state.kind === 'ready' ? state.reportsTotal : 0;
  const anomalyCount = state.kind === 'ready' ? state.anomalies.length : 0;

  return (
    <SiteFrame
      eyebrow="Operations dashboard"
      title="System health, moderation, and lifecycle."
      summary="Authenticated admin view for file management, report triage, download monitoring, queue health, and anomaly backlog."
      rail={<AdminRail state={state} onLogout={handleLogout} />}
    >
      {state.kind === 'loading' && (
        <section className="panel panel--feature">
          <p className="panel__label">Connecting</p>
          <p className="panel__copy">
            Checking the current admin session and loading dashboard data.
          </p>
        </section>
      )}

      {state.kind === 'unauthenticated' && (
        <section className="panel panel--feature">
          <div className="admin-login-card">
            <p className="panel__label">Admin access</p>
            <h2 className="admin-section-title">Sign in to continue.</h2>
            <p className="panel__copy">
              The operations dashboard requires authentication with the allowlisted GitHub account.
            </p>
            {unauthenticatedMessage ? (
              <p className="upload-error">{unauthenticatedMessage}</p>
            ) : null}
            <button type="button" className="button-link" onClick={handleLogin}>
              Sign in with GitHub
            </button>
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
          <div className="admin-toolbar">
            <div className="admin-toolbar__content">
              <p className="panel__label">Signed in as {state.session.githubLogin}</p>
            </div>
            <div className="admin-toolbar__actions">
              <span className="chip chip--outline">{isRefreshing ? 'Refreshing' : 'Live'}</span>
              <button
                type="button"
                className="button-link button-link--ghost button-link--sm"
                onClick={refresh}
                disabled={isRefreshing}
              >
                Refresh
              </button>
            </div>
          </div>

          <nav className="admin-nav" aria-label="Dashboard sections">
            <button
              type="button"
              className={`admin-nav__tab ${activeTab === 'overview' ? 'admin-nav__tab--active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              Overview
            </button>
            <button
              type="button"
              className={`admin-nav__tab ${activeTab === 'files' ? 'admin-nav__tab--active' : ''}`}
              onClick={() => setActiveTab('files')}
            >
              Files
            </button>
            <button
              type="button"
              className={`admin-nav__tab ${activeTab === 'reports' ? 'admin-nav__tab--active' : ''} ${pendingReportsCount > 0 ? 'admin-nav__tab--badge' : ''}`}
              data-badge={pendingReportsCount > 0 ? String(pendingReportsCount) : undefined}
              onClick={() => setActiveTab('reports')}
            >
              Reports
            </button>
            <button
              type="button"
              className={`admin-nav__tab ${activeTab === 'downloads' ? 'admin-nav__tab--active' : ''}`}
              onClick={() => setActiveTab('downloads')}
            >
              Downloads
            </button>
            <button
              type="button"
              className={`admin-nav__tab ${activeTab === 'storage' ? 'admin-nav__tab--active' : ''}`}
              onClick={() => setActiveTab('storage')}
            >
              Storage
            </button>
            <button
              type="button"
              className={`admin-nav__tab ${activeTab === 'queues' ? 'admin-nav__tab--active' : ''}`}
              onClick={() => setActiveTab('queues')}
            >
              Queues
            </button>
            <button
              type="button"
              className={`admin-nav__tab ${activeTab === 'anomalies' ? 'admin-nav__tab--active' : ''} ${anomalyCount > 0 ? 'admin-nav__tab--badge' : ''}`}
              data-badge={anomalyCount > 0 ? String(anomalyCount) : undefined}
              onClick={() => setActiveTab('anomalies')}
            >
              Anomalies
            </button>
          </nav>

          {inspectedFileId ? (
            <FileInspection
              fileId={inspectedFileId}
              onClose={() => setInspectedFileId(null)}
              onModerate={moderateFile}
              onAccessLost={handleAccessLost}
            />
          ) : null}

          {activeTab === 'overview' && <OverviewTab data={state} />}
          {activeTab === 'files' && (
            <FilesTab
              onInspect={openInspection}
              onModerate={moderateFile}
              onAccessLost={handleAccessLost}
            />
          )}
          {activeTab === 'reports' && (
            <ReportsTab
              onInspect={openInspection}
              onModerateFile={moderateFile}
              onAccessLost={handleAccessLost}
            />
          )}
          {activeTab === 'downloads' && (
            <DownloadsTab onInspect={openInspection} onAccessLost={handleAccessLost} />
          )}
          {activeTab === 'storage' && (
            <StorageTab data={state} onInspect={openInspection} onAccessLost={handleAccessLost} />
          )}
          {activeTab === 'queues' && <QueuesTab data={state} />}
          {activeTab === 'anomalies' && <AnomaliesTab data={state} />}
        </>
      )}
    </SiteFrame>
  );
}
