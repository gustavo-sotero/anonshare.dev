import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { AdminAccessError, getAdminAccessErrorMessage } from '~/admin/access';
import { AdminDashboardNav } from '~/admin/dashboard-nav';
import { ADMIN_LOGOUT_WARNING_MESSAGE, getAdminSurfaceMessage } from '~/admin/page-state';
import { runTrackedRequest, useRequestTracker } from '~/admin/request-tracker';
import type { AdminRouteLoaderData } from '~/admin/route-state';
import type { AdminSearchParams, AdminSearchUpdate } from '~/admin/search-params';
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
import { SiteFooter } from '~/components/site-footer';

type AdminPageProps = {
  loaderData: AdminRouteLoaderData;
  activeTab?: AdminTab;
  inspectedFileId?: string | null;
  searchState?: AdminSearchParams;
  onNavigate?: (tab: AdminTab, fileId: string | null) => void;
  onUpdateSearch?: (updates: AdminSearchUpdate) => void;
};

export function AdminPage({
  loaderData,
  activeTab = 'overview',
  inspectedFileId = null,
  searchState,
  onNavigate,
  onUpdateSearch
}: AdminPageProps) {
  const requestTracker = useRequestTracker();
  const [state, setState] = useState<DashboardState>(() => loaderData.initialState);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loginActionError, setLoginActionError] = useState<string | null>(null);
  const [logoutWarning, setLogoutWarning] = useState<string | null>(null);

  useEffect(() => {
    setState(loaderData.initialState);

    if (loaderData.initialState.kind !== 'ready') {
      onNavigate?.('overview', null);
    }

    setLogoutWarning(null);
  }, [loaderData.initialState, onNavigate]);

  const handleAccessLost = useCallback(
    (error: AdminAccessError) => {
      onNavigate?.('overview', null);
      setLogoutWarning(null);
      setState({
        kind: 'unauthenticated',
        error: getAdminAccessErrorMessage(error.reason)
      });
    },
    [onNavigate]
  );

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
    onNavigate?.('overview', null);
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

  if (state.kind === 'loading') {
    return (
      <AdminGate>
        <p className="panel__label">Connecting</p>
        <p className="panel__copy">
          Checking the current admin session and loading dashboard data.
        </p>
      </AdminGate>
    );
  }

  if (state.kind === 'error') {
    return (
      <AdminGate>
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
      </AdminGate>
    );
  }

  if (state.kind === 'unauthenticated') {
    return (
      <AdminGate>
        <p className="panel__label">Admin access</p>
        <h1 className="admin-section-title">Sign in to continue.</h1>
        <p className="panel__copy">
          The operations dashboard requires authentication with the allowlisted GitHub account.
        </p>
        {surfaceMessage ? <p className="upload-error">{surfaceMessage}</p> : null}
        <button type="button" className="button-link" onClick={handleLogin}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
            className="admin-login-card__button-icon"
          >
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          Sign in with GitHub
        </button>
      </AdminGate>
    );
  }

  return (
    <>
      <div className="admin-shell">
        <header className="admin-shell__topbar">
          <div className="admin-shell__brand">
            <span className="admin-shell__brand-mark">anonshare</span>
            <span className="admin-shell__brand-label">Admin</span>
          </div>
          <div className="admin-shell__topbar-actions">
            <span className="chip chip--outline">{isRefreshing ? 'Refreshing' : 'Live'}</span>
            <button
              type="button"
              className="button-link button-link--ghost button-link--sm"
              onClick={refresh}
              disabled={isRefreshing}
            >
              Refresh
            </button>
            <button
              type="button"
              className="button-link button-link--ghost button-link--sm"
              onClick={handleLogout}
            >
              Sign out
            </button>
          </div>
        </header>

        <div className="admin-shell__body">
          <nav className="admin-shell__sidebar">
            <AdminDashboardNav
              activeTab={activeTab}
              anomalyCount={anomalyCount}
              pendingReportsCount={pendingReportsCount}
              onSelectTab={(tab) => onNavigate?.(tab, inspectedFileId)}
            />
            <AdminRail state={state} onLogout={handleLogout} />
          </nav>

          <main className="admin-shell__content">
            {inspectedFileId ? (
              <FileInspection
                fileId={inspectedFileId}
                onClose={() => onNavigate?.(activeTab, null)}
                onModerate={moderateFile}
                onAccessLost={handleAccessLost}
              />
            ) : null}

            {activeTab === 'overview' && <OverviewTab data={state} />}
            {activeTab === 'files' && (
              <FilesTab
                searchState={searchState}
                onUpdateSearch={onUpdateSearch}
                onInspect={(id) => onNavigate?.(activeTab, id)}
                onModerate={moderateFile}
                onAccessLost={handleAccessLost}
              />
            )}
            {activeTab === 'reports' && (
              <ReportsTab
                searchState={searchState}
                onUpdateSearch={onUpdateSearch}
                onInspect={(id) => onNavigate?.(activeTab, id)}
                onModerateFile={moderateFile}
                onAccessLost={handleAccessLost}
              />
            )}
            {activeTab === 'downloads' && (
              <DownloadsTab
                searchState={searchState}
                onUpdateSearch={onUpdateSearch}
                onInspect={(id) => onNavigate?.(activeTab, id)}
                onAccessLost={handleAccessLost}
              />
            )}
            {activeTab === 'storage' && (
              <StorageTab
                data={state}
                searchState={searchState}
                onUpdateSearch={onUpdateSearch}
                onInspect={(id) => onNavigate?.(activeTab, id)}
                onAccessLost={handleAccessLost}
              />
            )}
            {activeTab === 'queues' && <QueuesTab data={state} />}
            {activeTab === 'anomalies' && <AnomaliesTab data={state} />}
          </main>
        </div>
      </div>

      <SiteFooter />
    </>
  );
}

function AdminGate({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <div className="admin-login-screen">
        <div className="admin-login-card">
          <p className="admin-login-card__brand">anonshare</p>
          {children}
        </div>
      </div>
      <SiteFooter />
    </>
  );
}
