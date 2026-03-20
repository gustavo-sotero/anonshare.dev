import { describe, expect, it } from 'bun:test';

// Import the standalone function directly to avoid pulling in transport's
// full import tree (which depends on @anonshare/contracts + fetch globals).
// The function is re-exported here for isolated unit testing.
import { extractErrorMessage } from './transport';

describe('extractErrorMessage', () => {
  it('extracts a top-level message field', () => {
    expect(extractErrorMessage({ message: 'Not found' }, 'fallback')).toBe('Not found');
  });

  it('extracts a nested error.message field', () => {
    expect(extractErrorMessage({ error: { message: 'Validation failed' } }, 'fallback')).toBe(
      'Validation failed'
    );
  });

  it('returns the fallback for null or undefined bodies', () => {
    expect(extractErrorMessage(null, 'oops')).toBe('oops');
    expect(extractErrorMessage(undefined, 'oops')).toBe('oops');
  });

  it('returns the fallback when the body is a non-object', () => {
    expect(extractErrorMessage('string body', 'fallback')).toBe('fallback');
    expect(extractErrorMessage(42, 'fallback')).toBe('fallback');
  });

  it('returns the fallback when no recognized message field is present', () => {
    expect(extractErrorMessage({ code: 'ERR' }, 'fallback')).toBe('fallback');
  });
});
