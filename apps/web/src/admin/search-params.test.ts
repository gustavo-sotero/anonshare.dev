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
    expect(result).toEqual({ error: 'state_expired' });
    expect(Object.keys(result)).toEqual(['error']);
  });
});
