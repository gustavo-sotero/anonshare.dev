import { describe, expect, test } from 'bun:test';
import {
  getMaxExpirationDate,
  isPreviewSupported,
  MAX_EXPIRATION_DAYS,
  MAX_FILE_SIZE_BYTES,
  normalizeMimeType,
  PREVIEW_ALLOWED_MIME_TYPES,
  REPORT_REASON_VALUES,
  REPORT_STATUS_VALUES,
  validateUploadOptions,
  validateUploadPolicy
} from './rules';

describe('MAX_FILE_SIZE_BYTES', () => {
  test('equals 256 MB', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(256 * 1024 * 1024);
  });
});

describe('MAX_EXPIRATION_DAYS', () => {
  test('equals 30 days', () => {
    expect(MAX_EXPIRATION_DAYS).toBe(30);
  });
});

describe('canonical report values', () => {
  test('exports the supported report reasons', () => {
    expect(REPORT_REASON_VALUES).toEqual([
      'illegal_content',
      'copyright_violation',
      'malware',
      'spam',
      'other'
    ]);
  });

  test('exports the supported report statuses', () => {
    expect(REPORT_STATUS_VALUES).toEqual(['pending', 'resolved', 'dismissed']);
  });
});

describe('isPreviewSupported', () => {
  const supported = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'video/mp4',
    'video/webm',
    'audio/mpeg',
    'audio/ogg',
    'audio/wav',
    'application/pdf',
    'text/plain',
    'text/markdown'
  ];

  test.each(supported)('returns true for %s', (mimeType: string) => {
    expect(isPreviewSupported(mimeType)).toBe(true);
  });

  test('returns false for unsupported MIME types', () => {
    expect(isPreviewSupported('application/zip')).toBe(false);
    expect(isPreviewSupported('application/octet-stream')).toBe(false);
    expect(isPreviewSupported('application/x-executable')).toBe(false);
    expect(isPreviewSupported('')).toBe(false);
  });

  test('normalizes case and parameters before preview allowlist checks', () => {
    expect(isPreviewSupported('Text/Plain; Charset = UTF-8')).toBe(true);
    expect(isPreviewSupported('APPLICATION/PDF')).toBe(true);
  });

  test('PREVIEW_ALLOWED_MIME_TYPES contains all supported types', () => {
    for (const mime of supported) {
      expect(PREVIEW_ALLOWED_MIME_TYPES.has(mime)).toBe(true);
    }
  });
});

describe('normalizeMimeType', () => {
  test('normalizes casing and parameter spacing', () => {
    expect(normalizeMimeType(' Text/Plain; Charset = UTF-8 ; Format = Flowed ')).toBe(
      'text/plain;charset=utf-8;format=flowed'
    );
  });

  test('returns an empty string for whitespace-only values', () => {
    expect(normalizeMimeType('   ')).toBe('');
  });
});

describe('validateUploadOptions', () => {
  test('allows non-one-time file with preview enabled', () => {
    const result = validateUploadOptions({ oneTime: false, allowPreview: true });
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test('allows one-time file without preview (PRD invariant)', () => {
    const result = validateUploadOptions({ oneTime: true, allowPreview: false });
    expect(result.valid).toBe(true);
  });

  test('allows file with neither one-time nor preview', () => {
    const result = validateUploadOptions({ oneTime: false, allowPreview: false });
    expect(result.valid).toBe(true);
  });

  test('rejects one-time file with preview enabled (PRD §4 invariant)', () => {
    const result = validateUploadOptions({ oneTime: true, allowPreview: true });
    expect(result.valid).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});

describe('validateUploadPolicy', () => {
  test('rejects past expirations', () => {
    const now = new Date('2026-03-11T12:00:00.000Z');
    const result = validateUploadPolicy(
      {
        oneTime: false,
        allowPreview: false,
        expiresAt: new Date('2026-03-11T11:59:59.000Z')
      },
      now
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({
      path: 'expiresAt',
      message: 'Expiration must be in the future.'
    });
  });

  test('rejects expirations beyond the max retention window', () => {
    const now = new Date('2026-03-11T12:00:00.000Z');
    const result = validateUploadPolicy(
      {
        oneTime: false,
        allowPreview: false,
        expiresAt: new Date('2026-04-11T12:00:01.000Z')
      },
      now
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({
      path: 'expiresAt',
      message: `Expiration cannot be more than ${MAX_EXPIRATION_DAYS} days from now.`
    });
  });

  test('accepts expirations exactly at the max retention window', () => {
    const now = new Date('2026-03-11T12:00:00.000Z');
    const result = validateUploadPolicy(
      {
        oneTime: false,
        allowPreview: true,
        expiresAt: getMaxExpirationDate(now)
      },
      now
    );

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });
});
