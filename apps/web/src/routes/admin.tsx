import {
  type AdminAnomaliesResponse,
  type AdminLifecycleStatsResponse,
  type AdminSession,
  type AdminSessionResponse,
  adminAnomaliesResponseSchema,
  adminLifecycleStatsResponseSchema,
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
      refreshedAt: string;
    };

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
    const message =
      typeof body === 'object' &&
      body !== null &&
      'message' in body &&
      typeof (body as { message: unknown }).message === 'string'
        ? (body as { message: string }).message
        : `Request failed with status ${response.status}.`;
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

async function loadDashboardState(signal: AbortSignal): Promise<DashboardState> {
  const sessionResponse = await fetchAdminSession(signal);

  if (!sessionResponse.authenticated || !sessionResponse.session) {
    return { kind: 'unauthenticated' };
  }

  const [statsResponse, anomaliesResponse] = await Promise.all([
    fetchAdminStats(signal),
    fetchAdminAnomalies(signal)
  ]);

  return {
    kind: 'ready',
    session: sessionResponse.session,
    stats: statsResponse,
    anomalies: anomaliesResponse.anomalies,
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

  const refresh = () => setRefreshKey((current) => current + 1);

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

  return (
    <SiteFrame
      eyebrow="Lifecycle dashboard"
      title="Queue health, anomaly backlog, and reconciliation signals in one place."
      summary="Module 5 now feeds the operator surface with lifecycle telemetry from the API boundary: unresolved anomalies, queue lag, and the current state of delayed cleanup work."
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
                  and /api/admin/anomalies to expose the current lifecycle backlog.
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
