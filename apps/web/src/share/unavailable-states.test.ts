import { describe, expect, it } from 'bun:test';
import { getUnavailabilityIcon, getUnavailabilityInfo, UNAVAILABILITY } from './unavailable-states';

describe('UNAVAILABILITY map', () => {
  it('has entries for all expected lifecycle state codes', () => {
    const requiredCodes = [
      'file_expired',
      'file_consumed',
      'file_hidden',
      'file_deleted',
      'file_unavailable',
      'not_found'
    ];

    for (const code of requiredCodes) {
      expect(UNAVAILABILITY[code]).toBeDefined();
      expect(UNAVAILABILITY[code]?.label.length).toBeGreaterThan(0);
      expect(UNAVAILABILITY[code]?.message.length).toBeGreaterThan(0);
    }
  });

  it('does not reveal moderation state in the file_hidden message', () => {
    const hidden = UNAVAILABILITY.file_hidden;

    // The message must not mention flagging, moderation, or reports.
    // Domain-layer posture is non-disclosure for moderated content.
    expect(hidden?.message).not.toMatch(/flag/i);
    expect(hidden?.message).not.toMatch(/moderate/i);
    expect(hidden?.message).not.toMatch(/report/i);
    expect(hidden?.message).not.toMatch(/temporarily/i);
  });

  it('does not attribute deletion to the operator in the file_deleted message', () => {
    const deleted = UNAVAILABILITY.file_deleted;

    // The message should be neutral — it must not say "by the operator".
    expect(deleted?.message).not.toMatch(/by the operator/i);
  });

  it('uses explicit labels for expired and consumed states', () => {
    expect(UNAVAILABILITY.file_expired?.label).not.toBe('Unavailable');
    expect(UNAVAILABILITY.file_consumed?.label).not.toBe('Unavailable');
  });
});

describe('getUnavailabilityInfo', () => {
  it('returns the known entry for a recognized code', () => {
    const info = getUnavailabilityInfo('file_expired');

    expect(info.label).toBe('Expired');
  });

  it('returns a generic fallback for an unrecognized code', () => {
    const info = getUnavailabilityInfo('unknown_code');

    expect(info.label).toBe('Unavailable');
    expect(info.message).toBe('This file is not available right now.');
  });

  it('uses the provided fallback message when the code is unrecognized', () => {
    const info = getUnavailabilityInfo('unknown_code', 'Custom fallback message.');

    expect(info.message).toBe('Custom fallback message.');
  });

  it('does not use the fallback message when the code is recognized', () => {
    const info = getUnavailabilityInfo('file_expired', 'This should be ignored.');

    expect(info.message).toBe('This file has expired and is no longer available for download.');
  });
});

describe('getUnavailabilityIcon', () => {
  it('returns the hourglass icon for expired files', () => {
    expect(getUnavailabilityIcon('file_expired')).toBe('⏳');
  });

  it('returns the checkmark icon for consumed one-time files', () => {
    expect(getUnavailabilityIcon('file_consumed')).toBe('✓');
  });

  it('returns the generic unavailable icon for hidden, deleted, and transient states', () => {
    expect(getUnavailabilityIcon('file_hidden')).toBe('⊘');
    expect(getUnavailabilityIcon('file_deleted')).toBe('⊘');
    expect(getUnavailabilityIcon('file_unavailable')).toBe('⊘');
    expect(getUnavailabilityIcon('not_found')).toBe('⊘');
  });

  it('returns the generic unavailable icon for unknown codes', () => {
    expect(getUnavailabilityIcon('some_future_code')).toBe('⊘');
  });
});
