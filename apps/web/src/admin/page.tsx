import { useCallback, useEffect, useState } from 'react';
import { AdminAccessError, getAdminAccessErrorMessage } from '~/admin/access';
import { AdminDashboardNav } from '~/admin/dashboard-nav';
import { ADMIN_LOGOUT_WARNING_MESSAGE, getAdminSurfaceMessage } from '~/admin/page-state';
import { runTrackedRequest, useRequestTracker } from '~/admin/request-tracker';
import type { AdminRouteLoaderData } from '~/admin/route-state';
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
  logoutAdmin,
  postAdminJson
} from '~/admin/transport';
import { SiteFrame } from '~/components/site-frame';

type AdminPageProps = {
  loaderData: AdminRouteLoaderData;
};

export function AdminPage({ loaderData }: AdminPageProps) {
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

  const refresh = () => setRefreshKey((key) => key + 1);

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

    const result = await logoutAdmin();
    if (!result.ok) {
      console.warn('[admin] Server-side logout failed; local session cleared.', result.message);

      setLogoutWarning(ADMIN_LOGOUT_WARNING_MESSAGE);
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

  const routeLoginError = loaderData.loginError;
  const surfaceMessage = getAdminSurfaceMessage({
    state,
    logoutWarning,
    loginActionError,
    routeLoginError
  });
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
            {surfaceMessage ? <p className="upload-error">{surfaceMessage}</p> : null}
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

          <AdminDashboardNav
            activeTab={activeTab}
            anomalyCount={anomalyCount}
            pendingReportsCount={pendingReportsCount}
            onSelectTab={setActiveTab}
          />

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
              onInspect={setInspectedFileId}
              onModerate={moderateFile}
              onAccessLost={handleAccessLost}
            />
          )}
          {activeTab === 'reports' && (
            <ReportsTab
              onInspect={setInspectedFileId}
              onModerateFile={moderateFile}
              onAccessLost={handleAccessLost}
            />
          )}
          {activeTab === 'downloads' && (
            <DownloadsTab onInspect={setInspectedFileId} onAccessLost={handleAccessLost} />
          )}
          {activeTab === 'storage' && (
            <StorageTab
              data={state}
              onInspect={setInspectedFileId}
              onAccessLost={handleAccessLost}
            />
          )}
          {activeTab === 'queues' && <QueuesTab data={state} />}
          {activeTab === 'anomalies' && <AnomaliesTab data={state} />}
        </>
      )}
    </SiteFrame>
  );
}
