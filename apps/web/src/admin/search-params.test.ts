import { describe, expect, it } from 'bun:test';
import { parseAdminSearchParams } from './search-params';

describe('parseAdminSearchParams', () => {
  it('extracts a string error value', () => {
    expect(parseAdminSearchParams({ error: 'not_allowlisted' })).toEqual({
      error: 'not_allowlisted'
    });
  });

  it('returns an empty object when no error is present', () => {
    expect(parseAdminSearchParams({})).toEqual({});
  });

  it('ignores non-string error values', () => {
    expect(parseAdminSearchParams({ error: 42 })).toEqual({});
    expect(parseAdminSearchParams({ error: true })).toEqual({});
    expect(parseAdminSearchParams({ error: null })).toEqual({});
  });

  it('discards unrecognized keys', () => {
    const result = parseAdminSearchParams({ error: 'state_expired', tab: 'files', page: 2 });
    expect(result).toEqual({ error: 'state_expired', tab: 'files' });
    expect(Object.keys(result)).toEqual(['error', 'tab']);
  });

  it('discards unknown tab values', () => {
    const result = parseAdminSearchParams({ tab: 'not_a_tab' });
    expect(result).toEqual({});
  });

  it('parses a valid tab value', () => {
    expect(parseAdminSearchParams({ tab: 'reports' })).toEqual({ tab: 'reports' });
  });

  it('parses a valid fileId', () => {
    expect(parseAdminSearchParams({ fileId: 'abc-123' })).toEqual({ fileId: 'abc-123' });
  });

  it('discards empty fileId', () => {
    expect(parseAdminSearchParams({ fileId: '' })).toEqual({});
  });
});
