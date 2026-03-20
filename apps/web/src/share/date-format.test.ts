import { describe, expect, it } from 'bun:test';
import { formatDateDeterministic } from './date-format';

describe('formatDateDeterministic', () => {
  it('formats a UTC date as "Mon D, YYYY" regardless of locale', () => {
    expect(formatDateDeterministic('2026-01-05T00:00:00.000Z')).toBe('Jan 5, 2026');
    expect(formatDateDeterministic('2026-12-25T23:59:59.999Z')).toBe('Dec 25, 2026');
  });

  it('uses UTC month and day to avoid timezone-dependent shifts', () => {
    // Midnight UTC on March 1 — a locale offset could shift this to Feb 28/29
    expect(formatDateDeterministic('2026-03-01T00:00:00.000Z')).toBe('Mar 1, 2026');
  });

  it('produces stable output for SSR hydration (no Intl dependency)', () => {
    const iso = '2026-06-15T12:30:00.000Z';
    const first = formatDateDeterministic(iso);
    const second = formatDateDeterministic(iso);
    expect(first).toBe(second);
    expect(first).toBe('Jun 15, 2026');
  });
});
