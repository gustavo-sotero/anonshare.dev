import { describe, expect, it } from 'bun:test';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider
} from '@tanstack/react-router';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminPage } from './page';
import type { DashboardState } from './transport';

async function renderAdminPage(props: Parameters<typeof AdminPage>[0]) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const adminRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin',
    component: () => <AdminPage {...props} />
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([adminRoute]),
    history: createMemoryHistory({ initialEntries: ['/admin'] })
  });
  await router.load();
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

function makeReadyState(): DashboardState {
  return {
    kind: 'ready',
    session: {
      id: '00000000-0000-4000-8000-000000000001',
      githubId: '123',
      githubLogin: 'admin-user',
      expiresAt: '2030-01-01T00:00:00.000Z'
    },
    stats: {
      openAnomaliesTotal: 1,
      openAnomaliesByType: { orphaned_object: 1 },
      reportTotals: {
        total: 2,
        byStatus: { pending: 2, resolved: 0, dismissed: 0 }
      },
      abuseMetrics: {
        windowDays: 14,
        reportsByDay: [],
        autoHiddenByDay: [],
        resolvedReportsByDay: [],
        dismissedReportsByDay: [],
        rateLimitBlockedByDay: []
      },
      queueHealth: [],
      systemSettings: { degraded: false, details: [] }
    },
    overview: {
      totalFiles: 4,
      byStatus: { active: 2, hidden: 1, expired: 1 },
      totalStorageBytes: 4096,
      totalDownloads: 7
    },
    anomalies: [
      {
        id: '00000000-0000-4000-8000-000000000002',
        type: 'orphaned_object',
        severity: 'medium',
        fileId: null,
        details: null,
        detectedAt: '2030-01-01T00:00:00.000Z',
        resolvedAt: null,
        resolution: null
      }
    ],
    reports: [
      {
        id: '00000000-0000-4000-8000-000000000003',
        fileId: '00000000-0000-4000-8000-000000000004',
        reason: 'spam',
        urgency: 'medium',
        message: null,
        status: 'pending',
        resolvedBy: null,
        resolvedAt: null,
        createdAt: '2030-01-01T00:00:00.000Z'
      }
    ],
    refreshedAt: '2030-01-01T00:00:00.000Z'
  };
}

describe('AdminPage SSR', () => {
  it('renders a connecting gate while the browser boots the admin session', async () => {
    const html = await renderAdminPage({
      loaderData: {
        initialState: { kind: 'loading' },
        loginError: null
      }
    });

    expect(html).toContain('Connecting');
    expect(html).toContain('Checking the current admin session and loading dashboard data.');
  });

  it('renders the branded admin login gate without the public site frame', async () => {
    const html = await renderAdminPage({
      loaderData: {
        initialState: { kind: 'unauthenticated' },
        loginError: null
      }
    });

    expect(html).toContain('admin-login-card__brand');
    expect(html).toContain('anonshare');
    expect(html).toContain('Admin access');
    expect(html).toContain('Sign in to continue.');
    expect(html).toContain('Sign in with GitHub');
    expect(html).toContain(
      'The operations dashboard requires authentication with the allowlisted GitHub account.'
    );
    expect(html).toContain('anonshare — anonymous file sharing. no accounts. no trace.');
    expect(html).not.toContain('Share a file');
  });

  it('links the active dashboard tab to a labelled tabpanel', async () => {
    const html = await renderAdminPage({
      loaderData: {
        initialState: makeReadyState(),
        loginError: null
      },
      activeTab: 'overview'
    });

    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('id="admin-tab-overview"');
    expect(html).toContain('aria-controls="admin-tabpanel-overview"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('id="admin-tabpanel-overview"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('aria-labelledby="admin-tab-overview"');
  });
});
