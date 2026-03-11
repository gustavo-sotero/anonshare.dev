import { describe, expect, test } from 'bun:test';
import {
  FILE_STATUS_TRANSITION_RULES,
  FILE_STATUS_TRANSITION_TRIGGER_VALUES,
  FILE_STATUS_TRANSITIONS,
  FILE_STATUS_VALUES,
  type FileStatus,
  getTransitionRule,
  getUnavailabilityMessage,
  isPubliclyAccessible,
  isTransitionAllowed,
  isTransitionTriggeredBy,
  PUBLIC_FILE_STATUS_VALUES,
  UNAVAILABLE_FILE_STATUS_VALUES
} from './file-status';

describe('FILE_STATUS_VALUES', () => {
  test('lists the canonical lifecycle states exactly once', () => {
    expect(FILE_STATUS_VALUES).toEqual([
      'pending_upload',
      'active',
      'expiring',
      'expired',
      'hidden',
      'deleted',
      'consumed',
      'missing'
    ]);
  });

  test('keeps public and unavailable partitions in sync', () => {
    const allStatuses = new Set(FILE_STATUS_VALUES);

    for (const status of PUBLIC_FILE_STATUS_VALUES) {
      expect(allStatuses.has(status)).toBe(true);
      expect(UNAVAILABLE_FILE_STATUS_VALUES).not.toContain(status);
    }

    for (const status of UNAVAILABLE_FILE_STATUS_VALUES) {
      expect(allStatuses.has(status)).toBe(true);
      expect(PUBLIC_FILE_STATUS_VALUES).not.toContain(
        status as (typeof PUBLIC_FILE_STATUS_VALUES)[number]
      );
    }
  });
});

describe('FILE_STATUS_TRANSITIONS', () => {
  test('documents transition metadata with canonical trigger kinds', () => {
    expect(FILE_STATUS_TRANSITION_TRIGGER_VALUES).toEqual([
      'automatic',
      'manual',
      'reconciliation'
    ]);

    expect(FILE_STATUS_TRANSITION_RULES).toContainEqual(
      expect.objectContaining({
        from: 'active',
        to: 'hidden',
        triggers: ['automatic', 'manual']
      })
    );
  });

  test('pending_upload can only transition to active or deleted', () => {
    expect(FILE_STATUS_TRANSITIONS.pending_upload).toEqual(['active', 'deleted']);
  });

  test('active supports all forward lifecycle transitions', () => {
    const allowed = FILE_STATUS_TRANSITIONS.active;
    expect(allowed).toContain('expiring');
    expect(allowed).toContain('expired');
    expect(allowed).toContain('hidden');
    expect(allowed).toContain('deleted');
    expect(allowed).toContain('consumed');
    expect(allowed).toContain('missing');
  });

  test('expiring remains publicly accessible until it is consumed, hidden, expired, or reconciled away', () => {
    const allowed = FILE_STATUS_TRANSITIONS.expiring;
    expect(allowed).toContain('expired');
    expect(allowed).toContain('hidden');
    expect(allowed).toContain('deleted');
    expect(allowed).toContain('consumed');
    expect(allowed).toContain('missing');
  });

  test('deleted is a terminal state with no outgoing transitions', () => {
    expect(FILE_STATUS_TRANSITIONS.deleted).toEqual([]);
  });

  test('consumed is a terminal state with no outgoing transitions', () => {
    expect(FILE_STATUS_TRANSITIONS.consumed).toEqual([]);
  });

  test('hidden can be restored to active or deleted by admin', () => {
    const allowed = FILE_STATUS_TRANSITIONS.hidden;
    expect(allowed).toContain('active');
    expect(allowed).toContain('deleted');
  });

  test('missing can be recovered to active or cleaned up to deleted', () => {
    const allowed = FILE_STATUS_TRANSITIONS.missing;
    expect(allowed).toContain('active');
    expect(allowed).toContain('deleted');
  });
});

describe('isTransitionAllowed', () => {
  test('allows valid transitions', () => {
    expect(isTransitionAllowed('pending_upload', 'active')).toBe(true);
    expect(isTransitionAllowed('active', 'expired')).toBe(true);
    expect(isTransitionAllowed('active', 'consumed')).toBe(true);
    expect(isTransitionAllowed('active', 'missing')).toBe(true);
    expect(isTransitionAllowed('active', 'hidden')).toBe(true);
    expect(isTransitionAllowed('expiring', 'consumed')).toBe(true);
    expect(isTransitionAllowed('expiring', 'missing')).toBe(true);
    expect(isTransitionAllowed('hidden', 'active')).toBe(true);
    expect(isTransitionAllowed('expired', 'deleted')).toBe(true);
    expect(isTransitionAllowed('missing', 'active')).toBe(true);
  });

  test('rejects invalid transitions', () => {
    expect(isTransitionAllowed('deleted', 'active')).toBe(false);
    expect(isTransitionAllowed('consumed', 'active')).toBe(false);
    expect(isTransitionAllowed('expired', 'active')).toBe(false);
    expect(isTransitionAllowed('pending_upload', 'consumed')).toBe(false);
    expect(isTransitionAllowed('active', 'pending_upload')).toBe(false);
    expect(isTransitionAllowed('hidden', 'missing')).toBe(false);
  });

  test('exposes transition metadata for callers that need trigger context', () => {
    const rule = getTransitionRule('missing', 'active');

    expect(rule).not.toBeNull();
    expect(rule?.triggers).toEqual(['reconciliation']);
    expect(rule?.reason).toContain('Reconciliation');
  });

  test('reports whether a transition is valid for a specific trigger type', () => {
    expect(isTransitionTriggeredBy('active', 'hidden', 'automatic')).toBe(true);
    expect(isTransitionTriggeredBy('active', 'hidden', 'manual')).toBe(true);
    expect(isTransitionTriggeredBy('active', 'hidden', 'reconciliation')).toBe(false);
    expect(isTransitionTriggeredBy('active', 'missing', 'reconciliation')).toBe(true);
    expect(isTransitionTriggeredBy('expiring', 'consumed', 'automatic')).toBe(true);
  });
});

describe('isPubliclyAccessible', () => {
  const accessible: FileStatus[] = ['active', 'expiring'];
  const inaccessible: FileStatus[] = [
    'pending_upload',
    'expired',
    'hidden',
    'deleted',
    'consumed',
    'missing'
  ];

  test.each(accessible)('returns true for %s', (status: FileStatus) => {
    expect(isPubliclyAccessible(status)).toBe(true);
  });

  test.each(inaccessible)('returns false for %s', (status: FileStatus) => {
    expect(isPubliclyAccessible(status)).toBe(false);
  });
});

describe('getUnavailabilityMessage', () => {
  test('returns null for publicly accessible statuses', () => {
    expect(getUnavailabilityMessage('active')).toBeNull();
    expect(getUnavailabilityMessage('expiring')).toBeNull();
  });

  test('returns specific message for expired', () => {
    const msg = getUnavailabilityMessage('expired');
    expect(msg).not.toBeNull();
    expect(msg).toContain('expired');
  });

  test('returns specific message for consumed', () => {
    const msg = getUnavailabilityMessage('consumed');
    expect(msg).not.toBeNull();
    expect(msg).toContain('downloaded');
  });

  test('returns specific message for deleted', () => {
    const msg = getUnavailabilityMessage('deleted');
    expect(msg).not.toBeNull();
    expect(msg).toContain('deleted');
  });

  test('returns generic unavailability message for hidden (no state disclosure)', () => {
    const msg = getUnavailabilityMessage('hidden');
    expect(msg).not.toBeNull();
    expect(msg).not.toContain('hidden');
  });

  test('returns generic unavailability message for missing (no state disclosure)', () => {
    const msg = getUnavailabilityMessage('missing');
    expect(msg).not.toBeNull();
    expect(msg).not.toContain('missing');
  });

  test('returns message for pending_upload', () => {
    const msg = getUnavailabilityMessage('pending_upload');
    expect(msg).not.toBeNull();
  });
});
