import { API_ERROR_CODES } from '@anonshare/contracts';

/**
 * Map a file status to the most specific API error code.
 * Collapsed status values (hidden, missing) use the generic unavailable code
 * to avoid leaking internal state to anonymous callers.
 */
export function statusToErrorCode(status: string): string {
  switch (status) {
    case 'expired':
      return API_ERROR_CODES.FILE_EXPIRED;
    case 'hidden':
      return API_ERROR_CODES.FILE_HIDDEN;
    case 'deleted':
      return API_ERROR_CODES.FILE_DELETED;
    case 'consumed':
      return API_ERROR_CODES.FILE_CONSUMED;
    default:
      return API_ERROR_CODES.FILE_UNAVAILABLE;
  }
}

/**
 * Returns true when a file's expiration timestamp has passed, even if the
 * background job has not yet updated the stored status. This enforces
 * expiration at read time so that the public interface blocks access
 * immediately — independent of cleanup job execution.
 *
 * Only applies to publicly-accessible statuses (active / expiring); files
 * already in a terminal state have their own unavailability handling.
 */
export function isExpiredByTimestamp(file: { status: string; expiresAt: Date | null }): boolean {
  if (file.status !== 'active' && file.status !== 'expiring') return false;
  if (!file.expiresAt) return false;
  return file.expiresAt <= new Date();
}
