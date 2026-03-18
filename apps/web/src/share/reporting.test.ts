import { describe, expect, it } from 'bun:test';
import { canReportUnavailableFile } from './reporting';

describe('canReportUnavailableFile', () => {
  it('allows reports for expired links', () => {
    expect(canReportUnavailableFile('file_expired')).toBe(true);
  });

  it('allows reports for consumed one-time links', () => {
    expect(canReportUnavailableFile('file_consumed')).toBe(true);
  });

  it('blocks reports for hidden, deleted, missing, and transient failures', () => {
    expect(canReportUnavailableFile('file_hidden')).toBe(false);
    expect(canReportUnavailableFile('file_deleted')).toBe(false);
    expect(canReportUnavailableFile('file_unavailable')).toBe(false);
    expect(canReportUnavailableFile('not_found')).toBe(false);
  });

  it('blocks empty values', () => {
    expect(canReportUnavailableFile(null)).toBe(false);
    expect(canReportUnavailableFile(undefined)).toBe(false);
    expect(canReportUnavailableFile('')).toBe(false);
  });
});