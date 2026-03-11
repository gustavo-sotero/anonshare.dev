import { describe, expect, test } from 'bun:test';
import {
  API_ERROR_CODES,
  API_ERROR_HTTP_STATUS,
  apiEnvelopeSchema,
  apiErrorEnvelopeSchema,
  apiErrorSchema,
  apiSuccessEnvelopeSchema,
  getHttpStatusForApiError
} from './errors';
import { uploadResponseSchema } from './schemas/upload';

describe('apiErrorSchema', () => {
  test('accepts known error code and message', () => {
    const result = apiErrorSchema.safeParse({
      code: API_ERROR_CODES.VALIDATION_ERROR,
      message: 'Invalid payload',
      details: { filename: 'Required' }
    });

    expect(result.success).toBe(true);
  });

  test('rejects unknown error codes', () => {
    const result = apiErrorSchema.safeParse({
      code: 'unknown_error',
      message: 'Nope'
    });

    expect(result.success).toBe(false);
  });
});

describe('api envelopes', () => {
  test('accepts success envelope for a schema', () => {
    const successSchema = apiSuccessEnvelopeSchema(uploadResponseSchema);

    const result = successSchema.safeParse({
      ok: true,
      data: {
        shareToken: 'abc123DEF456_ghi-jkl',
        shareUrl: 'https://anonshare.dev/share/abc123DEF456_ghi-jkl',
        expiresAt: null
      }
    });

    expect(result.success).toBe(true);
  });

  test('accepts error envelope', () => {
    const result = apiErrorEnvelopeSchema.safeParse({
      ok: false,
      error: {
        code: API_ERROR_CODES.RATE_LIMITED,
        message: 'Too many requests'
      }
    });

    expect(result.success).toBe(true);
  });

  test('accepts union envelope for either success or error', () => {
    const envelopeSchema = apiEnvelopeSchema(uploadResponseSchema);

    const success = envelopeSchema.safeParse({
      ok: true,
      data: {
        shareToken: 'abc123DEF456_ghi-jkl',
        shareUrl: 'https://anonshare.dev/share/abc123DEF456_ghi-jkl',
        expiresAt: null
      }
    });

    const failure = envelopeSchema.safeParse({
      ok: false,
      error: {
        code: API_ERROR_CODES.FILE_TOO_LARGE,
        message: 'File too large'
      }
    });

    expect(success.success).toBe(true);
    expect(failure.success).toBe(true);
  });
});

describe('api error http status mapping', () => {
  test('maps canonical codes to expected statuses', () => {
    expect(getHttpStatusForApiError(API_ERROR_CODES.VALIDATION_ERROR)).toBe(400);
    expect(getHttpStatusForApiError(API_ERROR_CODES.AUTH_REQUIRED)).toBe(401);
    expect(getHttpStatusForApiError(API_ERROR_CODES.ACCESS_DENIED)).toBe(403);
    expect(getHttpStatusForApiError(API_ERROR_CODES.NOT_FOUND)).toBe(404);
    expect(getHttpStatusForApiError(API_ERROR_CODES.CONFLICT)).toBe(409);
    expect(getHttpStatusForApiError(API_ERROR_CODES.FILE_CONSUMED)).toBe(410);
    expect(getHttpStatusForApiError(API_ERROR_CODES.FILE_TOO_LARGE)).toBe(413);
    expect(getHttpStatusForApiError(API_ERROR_CODES.RATE_LIMITED)).toBe(429);
    expect(getHttpStatusForApiError(API_ERROR_CODES.INTERNAL_ERROR)).toBe(500);
  });

  test('mapping covers every registered error code', () => {
    for (const code of Object.values(API_ERROR_CODES)) {
      expect(API_ERROR_HTTP_STATUS[code]).toBeDefined();
      expect(typeof API_ERROR_HTTP_STATUS[code]).toBe('number');
    }
  });
});
