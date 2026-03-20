import type { DashboardState } from './transport';

export const ADMIN_LOGOUT_WARNING_MESSAGE =
  'Signed out locally. Server logout could not be confirmed. Check API logs if the session persists.';

export function getAdminSurfaceMessage(params: {
  state: DashboardState;
  logoutWarning: string | null;
  loginActionError: string | null;
  routeLoginError: string | null;
}): string | null {
  const { loginActionError, logoutWarning, routeLoginError, state } = params;

  if (state.kind === 'unauthenticated') {
    return state.error ?? logoutWarning ?? loginActionError ?? routeLoginError;
  }

  return logoutWarning ?? loginActionError ?? routeLoginError;
}
