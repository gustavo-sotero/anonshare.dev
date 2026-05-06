import { describe, expect, test } from 'bun:test';
import { MAX_EXPIRATION_DAYS, MAX_FILE_SIZE_BYTES } from '@anonshare/domain';
import { uploadRequestSchema, uploadResponseSchema } from './upload';

const futureDate = (daysFromNow: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString();
};

const pastDate = (daysAgo: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
};

describe('uploadRequestSchema', () => {
  const base = {
    filename: 'example.txt',
    mimeType: 'text/plain',
    sizeBytes: 1024,
    oneTime: false,
    allowPreview: false,
    expiresAt: null
  };

  test('accepts a minimal valid upload request', () => {
    const result = uploadRequestSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  test('accepts a valid request with preview and expiration', () => {
    const result = uploadRequestSchema.safeParse({
      ...base,
      allowPreview: true,
      expiresAt: futureDate(7)
    });
    expect(result.success).toBe(true);
  });

  test('accepts a valid one-time request without preview', () => {
    const result = uploadRequestSchema.safeParse({
      ...base,
      oneTime: true,
      allowPreview: false
    });
    expect(result.success).toBe(true);
  });

  test('rejects one-time + preview combination (PRD invariant)', () => {
    const result = uploadRequestSchema.safeParse({
      ...base,
      oneTime: true,
      allowPreview: true
    });
    expect(result.success).toBe(false);
  });

  test('rejects file size above MAX_FILE_SIZE_BYTES', () => {
    const result = uploadRequestSchema.safeParse({
      ...base,
      sizeBytes: MAX_FILE_SIZE_BYTES + 1
    });
    expect(result.success).toBe(false);
  });

  test('rejects zero-byte files', () => {
    const result = uploadRequestSchema.safeParse({ ...base, sizeBytes: 0 });
    expect(result.success).toBe(false);
  });

  test('rejects expiration beyond MAX_EXPIRATION_DAYS', () => {
    const result = uploadRequestSchema.safeParse({
      ...base,
      expiresAt: futureDate(MAX_EXPIRATION_DAYS + 1)
    });
    expect(result.success).toBe(false);
  });

  test('rejects expiration in the past', () => {
    const result = uploadRequestSchema.safeParse({
      ...base,
      expiresAt: pastDate(1)
    });
    expect(result.success).toBe(false);
  });

  test('accepts expiration exactly at MAX_EXPIRATION_DAYS', () => {
    const result = uploadRequestSchema.safeParse({
      ...base,
      expiresAt: futureDate(MAX_EXPIRATION_DAYS)
    });
    expect(result.success).toBe(true);
  });

  test('rejects empty filename', () => {
    const result = uploadRequestSchema.safeParse({ ...base, filename: '' });
    expect(result.success).toBe(false);
  });

  test('rejects missing required fields', () => {
    const { filename: _omit, ...withoutFilename } = base;
    const result = uploadRequestSchema.safeParse(withoutFilename);
    expect(result.success).toBe(false);
  });

  test('accepts MIME type with charset parameter', () => {
    const result = uploadRequestSchema.safeParse({
      ...base,
      mimeType: 'text/plain;charset=utf-8'
    });
    expect(result.success).toBe(true);
  });

  test('accepts common binary MIME types', () => {
    for (const mimeType of [
      'application/octet-stream',
      'application/pdf',
      'image/png',
      'video/mp4'
    ]) {
      const result = uploadRequestSchema.safeParse({ ...base, mimeType });
      expect(result.success).toBe(true);
    }
  });

  test('rejects structurally invalid MIME type', () => {
    for (const mimeType of ['plaintext', 'text', '/plain', 'te xt/plain']) {
      const result = uploadRequestSchema.safeParse({ ...base, mimeType });
      expect(result.success).toBe(false);
    }
  });

  test('normalizes MIME type casing and spacing in parsed output', () => {
    const result = uploadRequestSchema.safeParse({
      ...base,
      mimeType: ' Text/Plain; Charset = UTF-8 '
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.mimeType).toBe('text/plain;charset=utf-8');
    }
  });
});

describe('uploadResponseSchema', () => {
  const base = {
    shareToken: 'abc123DEF456_ghi-jkl',
    shareUrl: 'https://anonshare.dev/share/abc123DEF456_ghi-jkl',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  };

  test('accepts valid response payload', () => {
    const result = uploadResponseSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  test('rejects token with invalid characters', () => {
    const result = uploadResponseSchema.safeParse({
      ...base,
      shareToken: 'abc123$%^invalid'
    });
    expect(result.success).toBe(false);
  });

  test('rejects token longer than 64 characters', () => {
    const result = uploadResponseSchema.safeParse({
      ...base,
      shareToken: 'a'.repeat(65)
    });
    expect(result.success).toBe(false);
  });
});
