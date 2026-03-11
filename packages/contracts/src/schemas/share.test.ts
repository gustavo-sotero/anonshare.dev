import { describe, expect, test } from 'bun:test';
import {
  blockedAccessResponseSchema,
  downloadUrlResponseSchema,
  fileMetaResponseSchema,
  previewUrlResponseSchema,
  shareTokenParamsSchema
} from './share';

describe('shareTokenParamsSchema', () => {
  test('accepts a valid share token', () => {
    const result = shareTokenParamsSchema.safeParse({ token: 'abc123DEF456_ghi-jkl' });
    expect(result.success).toBe(true);
  });

  test('rejects invalid token characters', () => {
    const result = shareTokenParamsSchema.safeParse({ token: 'abc123$%^' });
    expect(result.success).toBe(false);
  });

  test('rejects too-short tokens', () => {
    const result = shareTokenParamsSchema.safeParse({ token: 'short-token' });
    expect(result.success).toBe(false);
  });

  test('rejects too-long tokens', () => {
    const result = shareTokenParamsSchema.safeParse({ token: 'a'.repeat(65) });
    expect(result.success).toBe(false);
  });
});

describe('fileMetaResponseSchema', () => {
  const base = {
    shareToken: 'abc123DEF456_ghi-jkl',
    filename: 'report.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    status: 'active' as const,
    oneTime: false,
    allowPreview: true,
    expiresAt: null,
    createdAt: new Date().toISOString()
  };

  test('accepts a valid active response', () => {
    const result = fileMetaResponseSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  test('rejects one-time with allowPreview enabled', () => {
    const result = fileMetaResponseSchema.safeParse({
      ...base,
      oneTime: true,
      allowPreview: true
    });
    expect(result.success).toBe(false);
  });

  test('requires unavailabilityMessage for unavailable statuses', () => {
    const result = fileMetaResponseSchema.safeParse({
      ...base,
      status: 'expired'
    });
    expect(result.success).toBe(false);
  });

  test('rejects unavailabilityMessage for publicly accessible statuses', () => {
    const result = fileMetaResponseSchema.safeParse({
      ...base,
      status: 'active',
      unavailabilityMessage: 'This file has expired.'
    });
    expect(result.success).toBe(false);
  });

  test('rejects expiring status without expiresAt', () => {
    const result = fileMetaResponseSchema.safeParse({
      ...base,
      status: 'expiring',
      expiresAt: null
    });
    expect(result.success).toBe(false);
  });

  test('accepts unavailable status with unavailabilityMessage', () => {
    const result = fileMetaResponseSchema.safeParse({
      ...base,
      status: 'consumed',
      oneTime: true,
      allowPreview: false,
      unavailabilityMessage: 'This file has already been downloaded and is no longer available.'
    });
    expect(result.success).toBe(true);
  });

  test('rejects shareToken longer than 64 characters', () => {
    const result = fileMetaResponseSchema.safeParse({
      ...base,
      shareToken: 'a'.repeat(65)
    });
    expect(result.success).toBe(false);
  });
});

describe('downloadUrlResponseSchema', () => {
  test('accepts valid ephemeral URL response', () => {
    const result = downloadUrlResponseSchema.safeParse({
      url: 'https://storage.example.com/signed-url',
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    expect(result.success).toBe(true);
  });

  test('rejects invalid URL', () => {
    const result = downloadUrlResponseSchema.safeParse({
      url: 'not-a-url',
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    expect(result.success).toBe(false);
  });
});

describe('previewUrlResponseSchema', () => {
  test('accepts valid preview response', () => {
    const result = previewUrlResponseSchema.safeParse({
      url: 'https://storage.example.com/preview-url',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      mimeType: 'application/pdf'
    });
    expect(result.success).toBe(true);
  });

  test('rejects empty mimeType', () => {
    const result = previewUrlResponseSchema.safeParse({
      url: 'https://storage.example.com/preview-url',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      mimeType: ''
    });
    expect(result.success).toBe(false);
  });
});

describe('blockedAccessResponseSchema', () => {
  test('accepts pending_upload with retryAfterSeconds', () => {
    const result = blockedAccessResponseSchema.safeParse({
      status: 'pending_upload',
      code: 'file_unavailable',
      message: 'This file is still being processed.',
      retryAfterSeconds: 30
    });

    expect(result.success).toBe(true);
  });

  test('accepts expired with specific status code', () => {
    const result = blockedAccessResponseSchema.safeParse({
      status: 'expired',
      code: 'file_expired',
      message: 'This file has expired.'
    });

    expect(result.success).toBe(true);
  });

  test('rejects incompatible status/code combinations', () => {
    const result = blockedAccessResponseSchema.safeParse({
      status: 'deleted',
      code: 'file_expired',
      message: 'Unavailable.'
    });

    expect(result.success).toBe(false);
  });

  test('rejects retryAfterSeconds for non-pending statuses', () => {
    const result = blockedAccessResponseSchema.safeParse({
      status: 'consumed',
      code: 'file_consumed',
      message: 'Already downloaded.',
      retryAfterSeconds: 60
    });

    expect(result.success).toBe(false);
  });
});
