import type { DashboardState } from './transport';
import { loadDashboardState } from './transport';

export type AdminRouteLoaderData = {
  initialState: DashboardState;
  loginError: string | null;
};

export function getAdminLoginErrorMessage(error: string | null | undefined): string | null {
  if (!error) {
    return null;
  }

  if (error === 'not_allowlisted') {
    return 'This GitHub account is not authorized to access the admin dashboard.';
  }

  if (error === 'state_expired') {
    return 'Login session expired. Please try again.';
  }

  return `Login failed: ${error.replaceAll('_', ' ')}`;
}

export async function loadAdminRouteData(
  params: {
    error?: string | null;
    signal?: AbortSignal;
    loadDashboardStateImpl?: (signal?: AbortSignal) => Promise<DashboardState>;
  } = {}
): Promise<AdminRouteLoaderData> {
  if (!params.loadDashboardStateImpl && typeof window === 'undefined') {
    return {
      initialState: { kind: 'loading' },
      loginError: getAdminLoginErrorMessage(params.error)
    };
  }

  const loadState = params.loadDashboardStateImpl ?? loadDashboardState;

  return {
    initialState: await loadState(params.signal),
    loginError: getAdminLoginErrorMessage(params.error)
  };
}
