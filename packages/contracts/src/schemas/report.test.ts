import { describe, expect, test } from 'bun:test';
import { reportRequestSchema, reportResponseSchema } from './report';

describe('reportRequestSchema', () => {
  test('accepts a valid report request', () => {
    const result = reportRequestSchema.safeParse({
      reason: 'spam',
      message: 'Looks suspicious.'
    });
    expect(result.success).toBe(true);
  });

  test('accepts a valid report request without message', () => {
    const result = reportRequestSchema.safeParse({
      reason: 'other'
    });
    expect(result.success).toBe(true);
  });

  test('rejects invalid reason', () => {
    const result = reportRequestSchema.safeParse({
      reason: 'invalid_reason',
      message: 'test'
    });
    expect(result.success).toBe(false);
  });

  test('rejects message longer than 1000 chars', () => {
    const result = reportRequestSchema.safeParse({
      reason: 'other',
      message: 'a'.repeat(1001)
    });
    expect(result.success).toBe(false);
  });
});

describe('reportResponseSchema', () => {
  test('accepts valid UUID and ISO datetime', () => {
    const result = reportResponseSchema.safeParse({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    });
    expect(result.success).toBe(true);
  });

  test('rejects invalid UUID', () => {
    const result = reportResponseSchema.safeParse({
      id: 'not-a-uuid',
      createdAt: new Date().toISOString()
    });
    expect(result.success).toBe(false);
  });
});
