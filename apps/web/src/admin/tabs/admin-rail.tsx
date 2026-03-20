import { formatDateTime } from '~/admin/formatters';
import type { DashboardState } from '~/admin/transport';

export function AdminRail({ state, onLogout }: { state: DashboardState; onLogout: () => void }) {
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
