import { describe, expect, test } from 'bun:test';
import {
  accessDeniedResponseSchema,
  adminLoginCallbackSchema,
  adminLoginStartResponseSchema,
  adminSessionResponseSchema,
  moderationActionSchema,
  resolveReportSchema
} from './admin';

describe('moderationActionSchema', () => {
  test('accepts supported moderation actions', () => {
    expect(moderationActionSchema.safeParse({ action: 'hide' }).success).toBe(true);
    expect(moderationActionSchema.safeParse({ action: 'restore' }).success).toBe(true);
    expect(moderationActionSchema.safeParse({ action: 'delete' }).success).toBe(true);
  });

  test('rejects unsupported moderation action', () => {
    const result = moderationActionSchema.safeParse({ action: 'archive' });
    expect(result.success).toBe(false);
  });

  test('rejects reason longer than 500 chars', () => {
    const result = moderationActionSchema.safeParse({ action: 'hide', reason: 'a'.repeat(501) });
    expect(result.success).toBe(false);
  });
});

describe('resolveReportSchema', () => {
  test('accepts supported resolve actions', () => {
    expect(resolveReportSchema.safeParse({ action: 'resolved' }).success).toBe(true);
    expect(resolveReportSchema.safeParse({ action: 'dismissed' }).success).toBe(true);
  });

  test('rejects unsupported resolve action', () => {
    const result = resolveReportSchema.safeParse({ action: 'reopen' });
    expect(result.success).toBe(false);
  });
});

describe('adminLoginCallbackSchema', () => {
  test('accepts callback payload with code and state', () => {
    const result = adminLoginCallbackSchema.safeParse({
      code: 'oauth-code',
      state: 'csrf-state'
    });
    expect(result.success).toBe(true);
  });

  test('rejects empty code/state', () => {
    const result = adminLoginCallbackSchema.safeParse({ code: '', state: '' });
    expect(result.success).toBe(false);
  });
});

describe('adminLoginStartResponseSchema', () => {
  test('accepts OAuth authorization URL and state', () => {
    const result = adminLoginStartResponseSchema.safeParse({
      authorizationUrl: 'https://github.com/login/oauth/authorize?client_id=abc',
      state: 'csrf-token'
    });

    expect(result.success).toBe(true);
  });

  test('rejects invalid URL', () => {
    const result = adminLoginStartResponseSchema.safeParse({
      authorizationUrl: 'not-a-url',
      state: 'csrf-token'
    });

    expect(result.success).toBe(false);
  });
});

describe('adminSessionResponseSchema', () => {
  test('accepts authenticated response with session', () => {
    const result = adminSessionResponseSchema.safeParse({
      authenticated: true,
      session: {
        id: crypto.randomUUID(),
        githubId: '123456',
        githubLogin: 'admin-user',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString()
      }
    });

    expect(result.success).toBe(true);
  });

  test('accepts unauthenticated response without session', () => {
    const result = adminSessionResponseSchema.safeParse({
      authenticated: false,
      session: null
    });

    expect(result.success).toBe(true);
  });

  test('rejects authenticated response without session', () => {
    const result = adminSessionResponseSchema.safeParse({
      authenticated: true,
      session: null
    });

    expect(result.success).toBe(false);
  });

  test('rejects authenticated response with non-numeric githubId', () => {
    const result = adminSessionResponseSchema.safeParse({
      authenticated: true,
      session: {
        id: crypto.randomUUID(),
        githubId: 'admin-user',
        githubLogin: 'admin-user',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString()
      }
    });

    expect(result.success).toBe(false);
  });

  test('rejects authenticated response with githubId longer than 64 chars', () => {
    const result = adminSessionResponseSchema.safeParse({
      authenticated: true,
      session: {
        id: crypto.randomUUID(),
        githubId: '1'.repeat(65),
        githubLogin: 'admin-user',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString()
      }
    });

    expect(result.success).toBe(false);
  });

  test('rejects authenticated response with githubLogin longer than 255 chars', () => {
    const result = adminSessionResponseSchema.safeParse({
      authenticated: true,
      session: {
        id: crypto.randomUUID(),
        githubId: '123456',
        githubLogin: 'a'.repeat(256),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString()
      }
    });

    expect(result.success).toBe(false);
  });
});

describe('accessDeniedResponseSchema', () => {
  test('accepts known denial reasons', () => {
    expect(
      accessDeniedResponseSchema.safeParse({
        reason: 'session_required',
        message: 'Authentication required.'
      }).success
    ).toBe(true);

    expect(
      accessDeniedResponseSchema.safeParse({
        reason: 'session_expired',
        message: 'Session expired.'
      }).success
    ).toBe(true);

    expect(
      accessDeniedResponseSchema.safeParse({
        reason: 'not_allowlisted',
        message: 'Access denied.'
      }).success
    ).toBe(true);
  });

  test('rejects unsupported denial reason', () => {
    const result = accessDeniedResponseSchema.safeParse({
      reason: 'ip_blocked',
      message: 'Denied.'
    });

    expect(result.success).toBe(false);
  });
});
