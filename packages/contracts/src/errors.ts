import { z } from 'zod';

/**
 * Canonical error code registry.
 *
 * These codes are emitted in API error envelopes (`ApiError.code`) so clients
 * can handle errors programmatically without parsing message strings.
 *
 * HTTP status mapping (non-exhaustive):
 *   400 → VALIDATION_ERROR, INVALID_OPTIONS
 *   401 → AUTH_REQUIRED
 *   403 → ACCESS_DENIED
 *   404 → NOT_FOUND
 *   409 → CONFLICT
 *   410 → FILE_EXPIRED, FILE_CONSUMED, FILE_HIDDEN, FILE_DELETED, FILE_UNAVAILABLE
 *   413 → FILE_TOO_LARGE
 *   429 → RATE_LIMITED
 *   500 → INTERNAL_ERROR
 */
export const API_ERROR_CODES = {
  VALIDATION_ERROR: 'validation_error',
  INVALID_OPTIONS: 'invalid_options',
  NOT_FOUND: 'not_found',
  FILE_EXPIRED: 'file_expired',
  FILE_HIDDEN: 'file_hidden',
  FILE_DELETED: 'file_deleted',
  FILE_CONSUMED: 'file_consumed',
  FILE_UNAVAILABLE: 'file_unavailable',
  FILE_TOO_LARGE: 'file_too_large',
  AUTH_REQUIRED: 'auth_required',
  ACCESS_DENIED: 'access_denied',
  CONFLICT: 'conflict',
  RATE_LIMITED: 'rate_limited',
  INTERNAL_ERROR: 'internal_error'
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

export const API_ERROR_HTTP_STATUS: Record<ApiErrorCode, number> = {
  [API_ERROR_CODES.VALIDATION_ERROR]: 400,
  [API_ERROR_CODES.INVALID_OPTIONS]: 400,
  [API_ERROR_CODES.NOT_FOUND]: 404,
  [API_ERROR_CODES.FILE_EXPIRED]: 410,
  [API_ERROR_CODES.FILE_HIDDEN]: 410,
  [API_ERROR_CODES.FILE_DELETED]: 410,
  [API_ERROR_CODES.FILE_CONSUMED]: 410,
  [API_ERROR_CODES.FILE_UNAVAILABLE]: 410,
  [API_ERROR_CODES.FILE_TOO_LARGE]: 413,
  [API_ERROR_CODES.AUTH_REQUIRED]: 401,
  [API_ERROR_CODES.ACCESS_DENIED]: 403,
  [API_ERROR_CODES.CONFLICT]: 409,
  [API_ERROR_CODES.RATE_LIMITED]: 429,
  [API_ERROR_CODES.INTERNAL_ERROR]: 500
};

export function getHttpStatusForApiError(code: ApiErrorCode): number {
  return API_ERROR_HTTP_STATUS[code];
}

const apiErrorCodeValues = Object.values(API_ERROR_CODES) as [ApiErrorCode, ...ApiErrorCode[]];

export const apiErrorSchema = z.object({
  code: z.enum(apiErrorCodeValues),
  message: z.string().min(1),
  details: z.record(z.string(), z.string()).optional()
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export function apiSuccessEnvelopeSchema<TSchema extends z.ZodType>(dataSchema: TSchema) {
  return z.object({
    ok: z.literal(true),
    data: dataSchema
  });
}

export const apiErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  error: apiErrorSchema
});

export function apiEnvelopeSchema<TSchema extends z.ZodType>(dataSchema: TSchema) {
  return z.union([apiSuccessEnvelopeSchema(dataSchema), apiErrorEnvelopeSchema]);
}

export type ApiSuccessEnvelope<TData> = {
  ok: true;
  data: TData;
};

export type ApiErrorEnvelope = {
  ok: false;
  error: ApiError;
};

export type ApiEnvelope<TData> = ApiSuccessEnvelope<TData> | ApiErrorEnvelope;
