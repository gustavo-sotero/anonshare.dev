import { accessDeniedResponseSchema } from '@anonshare/contracts';

export type AdminAccessFailureReason = 'session_required' | 'session_expired' | 'not_allowlisted';

const ADMIN_ACCESS_ERROR_MESSAGES: Record<AdminAccessFailureReason, string> = {
  session_required: 'Admin session required. Please sign in again.',
  session_expired: 'Your admin session expired. Please sign in again.',
  not_allowlisted: 'This GitHub account is not authorized to access the admin dashboard.'
};

export class AdminAccessError extends Error {
  readonly reason: AdminAccessFailureReason;

  constructor(reason: AdminAccessFailureReason = 'session_required') {
    super(ADMIN_ACCESS_ERROR_MESSAGES[reason]);
    this.name = 'AdminAccessError';
    this.reason = reason;
  }
}

export function getAdminAccessErrorMessage(reason: AdminAccessFailureReason): string {
  return ADMIN_ACCESS_ERROR_MESSAGES[reason];
}

export function createAdminAccessError(status: number, body: unknown): AdminAccessError {
  const parsed = accessDeniedResponseSchema.safeParse(body);

  if (parsed.success) {
    return new AdminAccessError(parsed.data.reason);
  }

  if (status === 403) {
    return new AdminAccessError('not_allowlisted');
  }

  return new AdminAccessError('session_required');
}