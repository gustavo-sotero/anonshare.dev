import { describe, expect, it } from 'bun:test';
import {
  AdminAccessError,
  createAdminAccessError,
  getAdminAccessErrorMessage
} from './access';

describe('createAdminAccessError', () => {
  it('uses the API reason when the access denied payload is valid', () => {
    const error = createAdminAccessError(401, {
      reason: 'session_expired',
      message: 'Session expired.'
    });

    expect(error).toBeInstanceOf(AdminAccessError);
    expect(error.reason).toBe('session_expired');
    expect(error.message).toBe('Your admin session expired. Please sign in again.');
  });

  it('falls back to not allowlisted for 403 payloads without a typed body', () => {
    const error = createAdminAccessError(403, { error: 'forbidden' });

    expect(error.reason).toBe('not_allowlisted');
    expect(error.message).toBe(
      'This GitHub account is not authorized to access the admin dashboard.'
    );
  });

  it('falls back to session required for unknown 401 responses', () => {
    const error = createAdminAccessError(401, null);

    expect(error.reason).toBe('session_required');
    expect(error.message).toBe('Admin session required. Please sign in again.');
  });
});

describe('getAdminAccessErrorMessage', () => {
  it('returns a stable operator-facing message for each access failure reason', () => {
    expect(getAdminAccessErrorMessage('session_required')).toBe(
      'Admin session required. Please sign in again.'
    );
    expect(getAdminAccessErrorMessage('session_expired')).toBe(
      'Your admin session expired. Please sign in again.'
    );
    expect(getAdminAccessErrorMessage('not_allowlisted')).toBe(
      'This GitHub account is not authorized to access the admin dashboard.'
    );
  });
});