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

  describe('files tab filters', () => {
    it('parses filesPage as a positive integer', () => {
      expect(parseAdminSearchParams({ filesPage: '3' })).toEqual({ filesPage: 3 });
      expect(parseAdminSearchParams({ filesPage: 5 })).toEqual({ filesPage: 5 });
    });

    it('discards invalid filesPage values', () => {
      expect(parseAdminSearchParams({ filesPage: '0' })).toEqual({});
      expect(parseAdminSearchParams({ filesPage: '-1' })).toEqual({});
      expect(parseAdminSearchParams({ filesPage: '1.5' })).toEqual({});
      expect(parseAdminSearchParams({ filesPage: 'abc' })).toEqual({});
    });

    it('accepts valid filesStatus values', () => {
      for (const v of [
        '',
        'active',
        'expiring',
        'expired',
        'hidden',
        'deleted',
        'consumed'
      ] as const) {
        expect(parseAdminSearchParams({ filesStatus: v })).toEqual({ filesStatus: v });
      }
    });

    it('discards invalid filesStatus values', () => {
      expect(parseAdminSearchParams({ filesStatus: 'unknown' })).toEqual({});
      expect(parseAdminSearchParams({ filesStatus: 42 } as Record<string, unknown>)).toEqual({});
    });

    it('accepts valid filesPolicy values', () => {
      for (const v of ['', 'standard', 'one_time', 'preview_enabled'] as const) {
        expect(parseAdminSearchParams({ filesPolicy: v })).toEqual({ filesPolicy: v });
      }
    });

    it('discards invalid filesPolicy values', () => {
      expect(parseAdminSearchParams({ filesPolicy: 'nope' })).toEqual({});
    });

    it('accepts valid filesSortBy values', () => {
      for (const v of ['uploadedAt_desc', 'sizeBytes_desc', 'reportCount_desc'] as const) {
        expect(parseAdminSearchParams({ filesSortBy: v })).toEqual({ filesSortBy: v });
      }
    });

    it('discards invalid filesSortBy values', () => {
      expect(parseAdminSearchParams({ filesSortBy: 'name_asc' })).toEqual({});
    });

    it('parses filesDays as a positive integer', () => {
      expect(parseAdminSearchParams({ filesDays: '7' })).toEqual({ filesDays: 7 });
      expect(parseAdminSearchParams({ filesDays: 30 })).toEqual({ filesDays: 30 });
    });

    it('discards invalid filesDays values', () => {
      expect(parseAdminSearchParams({ filesDays: '0' })).toEqual({});
      expect(parseAdminSearchParams({ filesDays: 'week' })).toEqual({});
    });

    it('parses filesMinReports as a positive integer', () => {
      expect(parseAdminSearchParams({ filesMinReports: '1' })).toEqual({ filesMinReports: 1 });
      expect(parseAdminSearchParams({ filesMinReports: 10 })).toEqual({ filesMinReports: 10 });
    });

    it('discards invalid filesMinReports values', () => {
      expect(parseAdminSearchParams({ filesMinReports: '0' })).toEqual({});
      expect(parseAdminSearchParams({ filesMinReports: '-5' })).toEqual({});
    });
  });

  describe('reports tab filters', () => {
    it('parses reportsPage as a positive integer', () => {
      expect(parseAdminSearchParams({ reportsPage: '2' })).toEqual({ reportsPage: 2 });
    });

    it('discards invalid reportsPage values', () => {
      expect(parseAdminSearchParams({ reportsPage: '0' })).toEqual({});
      expect(parseAdminSearchParams({ reportsPage: 'bad' })).toEqual({});
    });

    it('accepts valid reportsStatus values', () => {
      for (const v of ['pending', 'resolved', 'dismissed'] as const) {
        expect(parseAdminSearchParams({ reportsStatus: v })).toEqual({ reportsStatus: v });
      }
    });

    it('discards invalid reportsStatus values', () => {
      expect(parseAdminSearchParams({ reportsStatus: 'open' })).toEqual({});
    });

    it('accepts valid reportsReason values', () => {
      for (const v of [
        '',
        'illegal_content',
        'copyright_violation',
        'malware',
        'spam',
        'other'
      ] as const) {
        expect(parseAdminSearchParams({ reportsReason: v })).toEqual({ reportsReason: v });
      }
    });

    it('discards invalid reportsReason values', () => {
      expect(parseAdminSearchParams({ reportsReason: 'unknown_reason' })).toEqual({});
    });

    it('accepts valid reportsUrgency values', () => {
      for (const v of ['', 'high', 'medium', 'low'] as const) {
        expect(parseAdminSearchParams({ reportsUrgency: v })).toEqual({ reportsUrgency: v });
      }
    });

    it('discards invalid reportsUrgency values', () => {
      expect(parseAdminSearchParams({ reportsUrgency: 'critical' })).toEqual({});
    });
  });

  describe('downloads tab filters', () => {
    it('parses downloadsPage as a positive integer', () => {
      expect(parseAdminSearchParams({ downloadsPage: '4' })).toEqual({ downloadsPage: 4 });
    });

    it('discards invalid downloadsPage values', () => {
      expect(parseAdminSearchParams({ downloadsPage: '0' })).toEqual({});
    });

    it('parses a non-empty downloadsFileId', () => {
      expect(parseAdminSearchParams({ downloadsFileId: 'file-abc' })).toEqual({
        downloadsFileId: 'file-abc'
      });
    });

    it('discards empty downloadsFileId', () => {
      expect(parseAdminSearchParams({ downloadsFileId: '' })).toEqual({});
    });
  });

  describe('storage tab pagination', () => {
    it('parses storagePage as a positive integer', () => {
      expect(parseAdminSearchParams({ storagePage: '2' })).toEqual({ storagePage: 2 });
    });

    it('discards invalid storagePage values', () => {
      expect(parseAdminSearchParams({ storagePage: '0' })).toEqual({});
      expect(parseAdminSearchParams({ storagePage: 'x' })).toEqual({});
    });
  });

  describe('parsePositiveInt behavior (via field parsing)', () => {
    it('accepts numeric strings for page fields', () => {
      expect(parseAdminSearchParams({ filesPage: '10' })).toEqual({ filesPage: 10 });
    });

    it('accepts number values for page fields', () => {
      expect(parseAdminSearchParams({ filesPage: 10 })).toEqual({ filesPage: 10 });
    });

    it('rejects zero', () => {
      expect(parseAdminSearchParams({ filesPage: 0 })).toEqual({});
    });

    it('rejects negative numbers', () => {
      expect(parseAdminSearchParams({ filesPage: -3 })).toEqual({});
    });

    it('rejects non-integer decimals', () => {
      expect(parseAdminSearchParams({ filesPage: 2.5 })).toEqual({});
    });

    it('rejects non-numeric strings', () => {
      expect(parseAdminSearchParams({ filesPage: 'page1' })).toEqual({});
    });

    it('rejects null and boolean', () => {
      expect(parseAdminSearchParams({ filesPage: null })).toEqual({});
      expect(parseAdminSearchParams({ filesPage: true })).toEqual({});
    });
  });
});
