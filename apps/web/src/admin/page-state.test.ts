import { describe, expect, it } from 'bun:test';
import { ADMIN_LOGOUT_WARNING_MESSAGE, getAdminSurfaceMessage } from './page-state';
import type { DashboardState } from './transport';

describe('getAdminSurfaceMessage', () => {
  it('prefers explicit unauthenticated state errors', () => {
    const state: DashboardState = {
      kind: 'unauthenticated',
      error: 'Admin session required.'
    };

    expect(
      getAdminSurfaceMessage({
        state,
        logoutWarning: ADMIN_LOGOUT_WARNING_MESSAGE,
        loginActionError: 'Login failed.',
        routeLoginError: 'Route error.'
      })
    ).toBe('Admin session required.');
  });

  it('surfaces logout warnings when a ready session is cleared optimistically', () => {
    const state: DashboardState = {
      kind: 'ready',
      session: {
        id: 'session-1',
        githubId: '123',
        githubLogin: 'admin-user',
        expiresAt: '2030-01-01T00:00:00.000Z'
      },
      stats: {
        openAnomaliesTotal: 0,
        openAnomaliesByType: {},
        reportTotals: {
          total: 0,
          byStatus: { pending: 0, resolved: 0, dismissed: 0 }
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
        totalFiles: 0,
        byStatus: {},
        totalStorageBytes: 0,
        totalDownloads: 0
      },
      anomalies: [],
      reports: [],
      refreshedAt: '2030-01-01T00:00:00.000Z'
    };

    expect(
      getAdminSurfaceMessage({
        state,
        logoutWarning: ADMIN_LOGOUT_WARNING_MESSAGE,
        loginActionError: null,
        routeLoginError: null
      })
    ).toBe(ADMIN_LOGOUT_WARNING_MESSAGE);
  });
});
