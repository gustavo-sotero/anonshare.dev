import { formatDateTime } from '~/admin/formatters';
import type { DashboardState } from '~/admin/transport';

export function AdminRail({ state, onLogout }: { state: DashboardState; onLogout: () => void }) {
  return (
    <div className="admin-sidebar-rail">
      <div className="admin-sidebar-rail__section">
        <p className="admin-sidebar-rail__label">Lifecycle</p>
        <div className="admin-sidebar-rail__item">
          <span>Read block</span>
          <span>Expired files stop serving before cleanup runs</span>
        </div>
        <div className="admin-sidebar-rail__item">
          <span>Queue repair</span>
          <span>Reconcile restores missing jobs</span>
        </div>
        <div className="admin-sidebar-rail__item">
          <span>Integrity</span>
          <span>Missing objects surface as anomalies</span>
        </div>
      </div>

      {state.kind === 'ready' && (
        <div className="admin-sidebar-rail__section">
          <p className="admin-sidebar-rail__label">Session</p>
          <div className="admin-sidebar-rail__item">
            <span>Signed in</span>
            <span>{state.session.githubLogin}</span>
          </div>
          <div className="admin-sidebar-rail__item">
            <span>Expires</span>
            <span>{formatDateTime(state.session.expiresAt)}</span>
          </div>
          <div className="admin-sidebar-rail__item">
            <span>Refreshed</span>
            <span>{formatDateTime(state.refreshedAt)}</span>
          </div>
          <div className="admin-sidebar-rail__item">
            <button
              type="button"
              className="button-link button-link--ghost button-link--sm"
              onClick={onLogout}
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
