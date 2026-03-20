import type { AdminTab } from './transport';

type AdminDashboardNavProps = {
  activeTab: AdminTab;
  anomalyCount: number;
  pendingReportsCount: number;
  onSelectTab: (tab: AdminTab) => void;
};

export function AdminDashboardNav(props: AdminDashboardNavProps) {
  const { activeTab, anomalyCount, pendingReportsCount, onSelectTab } = props;

  return (
    <nav className="admin-nav" aria-label="Dashboard sections">
      <button
        type="button"
        className={`admin-nav__tab ${activeTab === 'overview' ? 'admin-nav__tab--active' : ''}`}
        onClick={() => onSelectTab('overview')}
      >
        Overview
      </button>
      <button
        type="button"
        className={`admin-nav__tab ${activeTab === 'files' ? 'admin-nav__tab--active' : ''}`}
        onClick={() => onSelectTab('files')}
      >
        Files
      </button>
      <button
        type="button"
        className={`admin-nav__tab ${activeTab === 'reports' ? 'admin-nav__tab--active' : ''} ${pendingReportsCount > 0 ? 'admin-nav__tab--badge' : ''}`}
        data-badge={pendingReportsCount > 0 ? String(pendingReportsCount) : undefined}
        onClick={() => onSelectTab('reports')}
      >
        Reports
      </button>
      <button
        type="button"
        className={`admin-nav__tab ${activeTab === 'downloads' ? 'admin-nav__tab--active' : ''}`}
        onClick={() => onSelectTab('downloads')}
      >
        Downloads
      </button>
      <button
        type="button"
        className={`admin-nav__tab ${activeTab === 'storage' ? 'admin-nav__tab--active' : ''}`}
        onClick={() => onSelectTab('storage')}
      >
        Storage
      </button>
      <button
        type="button"
        className={`admin-nav__tab ${activeTab === 'queues' ? 'admin-nav__tab--active' : ''}`}
        onClick={() => onSelectTab('queues')}
      >
        Queues
      </button>
      <button
        type="button"
        className={`admin-nav__tab ${activeTab === 'anomalies' ? 'admin-nav__tab--active' : ''} ${anomalyCount > 0 ? 'admin-nav__tab--badge' : ''}`}
        data-badge={anomalyCount > 0 ? String(anomalyCount) : undefined}
        onClick={() => onSelectTab('anomalies')}
      >
        Anomalies
      </button>
    </nav>
  );
}
