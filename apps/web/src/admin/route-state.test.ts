import { describe, expect, it } from 'bun:test';
import { getAdminLoginErrorMessage, loadAdminRouteData } from './route-state';
import type { DashboardState } from './transport';

describe('getAdminLoginErrorMessage', () => {
  it('returns null when there is no login error in route search state', () => {
    expect(getAdminLoginErrorMessage(undefined)).toBeNull();
    expect(getAdminLoginErrorMessage(null)).toBeNull();
    expect(getAdminLoginErrorMessage('')).toBeNull();
  });

  it('maps allowlist failures to the admin-facing copy', () => {
    expect(getAdminLoginErrorMessage('not_allowlisted')).toBe(
      'This GitHub account is not authorized to access the admin dashboard.'
    );
  });

  it('maps expired oauth state to a restart-safe retry message', () => {
    expect(getAdminLoginErrorMessage('state_expired')).toBe(
      'Login session expired. Please try again.'
    );
  });

  it('formats unknown oauth errors without route-level effects', () => {
    expect(getAdminLoginErrorMessage('token_exchange_failed')).toBe(
      'Login failed: token exchange failed'
    );
  });
});

describe('loadAdminRouteData', () => {
  it('passes the router abort signal through to dashboard loading', async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const initialState: DashboardState = { kind: 'unauthenticated' };

    const data = await loadAdminRouteData({
      error: 'state_expired',
      signal: controller.signal,
      loadDashboardStateImpl: async (signal) => {
        receivedSignal = signal;
        return initialState;
      }
    });

    expect(receivedSignal).toBe(controller.signal);
    expect(data.initialState).toBe(initialState);
    expect(data.loginError).toBe('Login session expired. Please try again.');
  });
});
