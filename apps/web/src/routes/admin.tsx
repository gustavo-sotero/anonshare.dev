import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { AdminAccessError, getAdminAccessErrorMessage } from '~/admin/access';
import { runTrackedRequest, useRequestTracker } from '~/admin/request-tracker';
import { type AdminRouteLoaderData, loadAdminRouteData } from '~/admin/route-state';
import { parseAdminSearchParams } from '~/admin/search-params';
import { AdminRail } from '~/admin/tabs/admin-rail';
import { AnomaliesTab } from '~/admin/tabs/anomalies-tab';
import { DownloadsTab } from '~/admin/tabs/downloads-tab';
import { FileInspection } from '~/admin/tabs/file-inspection';
import { FilesTab } from '~/admin/tabs/files-tab';
import { OverviewTab } from '~/admin/tabs/overview-tab';
import { QueuesTab } from '~/admin/tabs/queues-tab';
import { ReportsTab } from '~/admin/tabs/reports-tab';
import { StorageTab } from '~/admin/tabs/storage-tab';
import {
  type AdminTab,
  type DashboardState,
  extractErrorMessage,
  fetchAdminJson,
  loadDashboardState,
  postAdminJson
} from '~/admin/transport';
import { SiteFrame } from '~/components/site-frame';

export const Route = createFileRoute('/admin')({
  validateSearch: parseAdminSearchParams,
  loaderDeps: ({ search }) => ({ error: search.error ?? null }),
  loader: ({ deps, abortController }) =>
    loadAdminRouteData({ error: deps.error, signal: abortController.signal }),
  head: () => ({
    meta: [{ title: 'anonshare | Admin' }, { name: 'robots', content: 'noindex, nofollow' }]
  }),
  component: AdminPage
});

// ─── Main Page Component ─────────────────────────────────────────────────────

function AdminPage() {
  const loaderData = Route.useLoaderData() as AdminRouteLoaderData;
  const requestTracker = useRequestTracker();
  const [state, setState] = useState<DashboardState>(() => loaderData.initialState);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [inspectedFileId, setInspectedFileId] = useState<string | null>(null);
  const [loginActionError, setLoginActionError] = useState<string | null>(null);
  const [logoutWarning, setLogoutWarning] = useState<string | null>(null);

  useEffect(() => {
    setState(loaderData.initialState);

    if (loaderData.initialState.kind !== 'ready') {
      setInspectedFileId(null);
      setActiveTab('overview');
    }

    setLogoutWarning(null);
  }, [loaderData.initialState]);

  const handleAccessLost = useCallback((error: AdminAccessError) => {
    setInspectedFileId(null);
    setActiveTab('overview');
    setLogoutWarning(null);
    setState({
      kind: 'unauthenticated',
      error: getAdminAccessErrorMessage(error.reason)
    });
  }, []);

  useEffect(() => {
    if (refreshKey === 0) {
      return;
    }

    setIsRefreshing(true);

    void runTrackedRequest({
      tracker: requestTracker,
      run: (signal) => loadDashboardState(signal),
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
      setLoginActionError(null);
      setLogoutWarning(null);
      const body = await fetchAdminJson('/api/admin/auth/login');
      const result = body as { authorizationUrl: string };
      if (result.authorizationUrl) {
        window.location.href = result.authorizationUrl;
      }
    } catch (err) {
      setLoginActionError(err instanceof Error ? err.message : 'Failed to start login.');
    }
  };

  const handleLogout = async () => {
    setLogoutWarning(null);

    try {
      await postAdminJson('/api/admin/auth/logout', {});
    } catch (err) {
      // Server-side session may persist; local state cleared optimistically.
      // Log a warning so the failure is inspectable in browser devtools.
      console.warn(
        '[admin] Server-side logout failed; local session cleared.',
        err instanceof Error ? err.message : err
      );

      setLogoutWarning(
        'Signed out locally. Server logout could not be confirmed. Check API logs if the session persists.'
      );
    }
    setState({ kind: 'unauthenticated' });
    setInspectedFileId(null);
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

  const routeLoginError = loaderData.loginError;
  const unauthenticatedMessage =
    state.kind === 'unauthenticated'
      ? (state.error ?? logoutWarning ?? loginActionError ?? routeLoginError)
      : (logoutWarning ?? loginActionError ?? routeLoginError);

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
