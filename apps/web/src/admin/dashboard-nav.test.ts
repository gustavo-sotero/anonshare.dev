import { describe, expect, it } from 'bun:test';
import { getNextAdminDashboardTab } from './dashboard-nav';

describe('getNextAdminDashboardTab', () => {
  it('moves through tabs with directional keys and wraps at the edges', () => {
    expect(getNextAdminDashboardTab('overview', 'ArrowDown')).toBe('files');
    expect(getNextAdminDashboardTab('files', 'ArrowUp')).toBe('overview');
    expect(getNextAdminDashboardTab('anomalies', 'ArrowDown')).toBe('overview');
    expect(getNextAdminDashboardTab('overview', 'ArrowLeft')).toBe('anomalies');
  });

  it('supports Home and End shortcuts for the first and last tabs', () => {
    expect(getNextAdminDashboardTab('reports', 'Home')).toBe('overview');
    expect(getNextAdminDashboardTab('reports', 'End')).toBe('anomalies');
  });

  it('ignores unrelated keys', () => {
    expect(getNextAdminDashboardTab('reports', 'Enter')).toBeNull();
  });
});
