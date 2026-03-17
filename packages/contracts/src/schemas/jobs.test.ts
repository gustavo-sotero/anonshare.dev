import { describe, expect, test } from 'bun:test';
import {
  autoHideFileJobSchema,
  cleanupFileJobSchema,
  DOWNLOAD_URL_EXPIRY_GRACE_SECONDS,
  DOWNLOAD_URL_EXPIRY_SECONDS,
  expireFileJobSchema,
  ONE_TIME_DOWNLOAD_CLEANUP_DELAY_MS,
  reconcileJobSchema
} from './jobs';

describe('lifecycle timing constants', () => {
  test('keeps one-time cleanup delay aligned with download URL expiry and grace window', () => {
    expect(ONE_TIME_DOWNLOAD_CLEANUP_DELAY_MS).toBe(
      (DOWNLOAD_URL_EXPIRY_SECONDS + DOWNLOAD_URL_EXPIRY_GRACE_SECONDS) * 1000
    );
  });

  test('uses expected default download URL expiry window', () => {
    expect(DOWNLOAD_URL_EXPIRY_SECONDS).toBe(900);
  });
});

describe('expireFileJobSchema', () => {
  test('accepts a valid payload', () => {
    const result = expireFileJobSchema.safeParse({ fileId: crypto.randomUUID() });
    expect(result.success).toBe(true);
  });

  test('rejects invalid uuid payload', () => {
    const result = expireFileJobSchema.safeParse({ fileId: 'invalid' });
    expect(result.success).toBe(false);
  });
});

describe('cleanupFileJobSchema', () => {
  test('accepts a valid payload', () => {
    const result = cleanupFileJobSchema.safeParse({
      fileId: crypto.randomUUID(),
      objectKey: 'uploads/abc123/object.bin'
    });
    expect(result.success).toBe(true);
  });

  test('rejects empty objectKey', () => {
    const result = cleanupFileJobSchema.safeParse({
      fileId: crypto.randomUUID(),
      objectKey: ''
    });
    expect(result.success).toBe(false);
  });
});

describe('autoHideFileJobSchema', () => {
  test('accepts a valid payload', () => {
    const result = autoHideFileJobSchema.safeParse({ fileId: crypto.randomUUID() });
    expect(result.success).toBe(true);
  });

  test('rejects invalid uuid payload', () => {
    const result = autoHideFileJobSchema.safeParse({ fileId: 'invalid' });
    expect(result.success).toBe(false);
  });
});

describe('reconcileJobSchema', () => {
  test('accepts an empty payload', () => {
    const result = reconcileJobSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  test('accepts valid olderThan datetime', () => {
    const result = reconcileJobSchema.safeParse({ olderThan: new Date().toISOString() });
    expect(result.success).toBe(true);
  });

  test('rejects invalid olderThan datetime', () => {
    const result = reconcileJobSchema.safeParse({ olderThan: 'not-a-date' });
    expect(result.success).toBe(false);
  });
});
