import type { KeyboardEvent } from 'react';
import { useRef } from 'react';
import type { AdminTab } from './transport';

const ADMIN_DASHBOARD_TABS: readonly AdminTab[] = [
  'overview',
  'files',
  'reports',
  'downloads',
  'storage',
  'queues',
  'anomalies'
] as const;

export function getAdminDashboardTabId(tab: AdminTab): string {
  return `admin-tab-${tab}`;
}

export function getAdminDashboardTabPanelId(tab: AdminTab): string {
  return `admin-tabpanel-${tab}`;
}

export function getNextAdminDashboardTab(currentTab: AdminTab, key: string): AdminTab | null {
  const currentIndex = ADMIN_DASHBOARD_TABS.indexOf(currentTab);

  if (currentIndex === -1) {
    return null;
  }

  if (key === 'Home') {
    return ADMIN_DASHBOARD_TABS[0] ?? null;
  }

  if (key === 'End') {
    return ADMIN_DASHBOARD_TABS.at(-1) ?? null;
  }

  if (key === 'ArrowDown' || key === 'ArrowRight') {
    return ADMIN_DASHBOARD_TABS[(currentIndex + 1) % ADMIN_DASHBOARD_TABS.length] ?? null;
  }

  if (key === 'ArrowUp' || key === 'ArrowLeft') {
    return (
      ADMIN_DASHBOARD_TABS[
        (currentIndex - 1 + ADMIN_DASHBOARD_TABS.length) % ADMIN_DASHBOARD_TABS.length
      ] ?? null
    );
  }

  return null;
}

function getAdminTabLabel(tab: AdminTab): string {
  if (tab === 'overview') return 'Overview';
  if (tab === 'files') return 'Files';
  if (tab === 'reports') return 'Reports';
  if (tab === 'downloads') return 'Downloads';
  if (tab === 'storage') return 'Storage';
  if (tab === 'queues') return 'Queues';
  return 'Anomalies';
}

type AdminDashboardNavProps = {
  activeTab: AdminTab;
  anomalyCount: number;
  pendingReportsCount: number;
  onSelectTab: (tab: AdminTab) => void;
};

export function AdminDashboardNav(props: AdminDashboardNavProps) {
  const { activeTab, anomalyCount, pendingReportsCount, onSelectTab } = props;
  const tabRefs = useRef<Partial<Record<AdminTab, HTMLButtonElement | null>>>({});

  const handleKeyDown = (tab: AdminTab) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const nextTab = getNextAdminDashboardTab(tab, event.key);

    if (!nextTab || nextTab === tab) {
      return;
    }

    event.preventDefault();
    onSelectTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  };

  return (
    <div
      className="admin-nav"
      role="tablist"
      aria-label="Dashboard sections"
      aria-orientation="vertical"
    >
      {ADMIN_DASHBOARD_TABS.map((tab) => {
        const isActive = activeTab === tab;
        const isReportsTab = tab === 'reports';
        const isAnomaliesTab = tab === 'anomalies';
        const badgeValue = isReportsTab ? pendingReportsCount : isAnomaliesTab ? anomalyCount : 0;
        const badgeClass = isReportsTab
          ? 'admin-nav__tab--badge-warning'
          : isAnomaliesTab
            ? 'admin-nav__tab--badge'
            : '';

        return (
          <button
            key={tab}
            ref={(element) => {
              tabRefs.current[tab] = element;
            }}
            type="button"
            id={getAdminDashboardTabId(tab)}
            role="tab"
            aria-selected={isActive}
            aria-controls={getAdminDashboardTabPanelId(tab)}
            tabIndex={isActive ? 0 : -1}
            className={`admin-nav__tab ${isActive ? 'admin-nav__tab--active' : ''} ${badgeValue > 0 ? badgeClass : ''}`.trim()}
            data-badge={badgeValue > 0 ? String(badgeValue) : undefined}
            onClick={() => onSelectTab(tab)}
            onKeyDown={handleKeyDown(tab)}
          >
            {getAdminTabLabel(tab)}
          </button>
        );
      })}
    </div>
  );
}
