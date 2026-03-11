import {
  FILE_STATUS_VALUES,
  isPubliclyAccessible,
  UNAVAILABLE_FILE_STATUS_VALUES,
  type UnavailableFileStatus
} from '@anonshare/domain';
import { z } from 'zod';
import { API_ERROR_CODES } from '../errors';
import { SHARE_TOKEN_MAX_LENGTH, SHARE_TOKEN_MIN_LENGTH, SHARE_TOKEN_PATTERN } from './constants';

const blockedAccessCodeValues = [
  API_ERROR_CODES.FILE_UNAVAILABLE,
  API_ERROR_CODES.FILE_EXPIRED,
  API_ERROR_CODES.FILE_HIDDEN,
  API_ERROR_CODES.FILE_DELETED,
  API_ERROR_CODES.FILE_CONSUMED
] as const;

export const shareTokenParamsSchema = z.object({
  token: z
    .string()
    .min(SHARE_TOKEN_MIN_LENGTH)
    .max(SHARE_TOKEN_MAX_LENGTH)
    .regex(SHARE_TOKEN_PATTERN)
});

export type ShareTokenParams = z.infer<typeof shareTokenParamsSchema>;

export const fileMetaResponseSchema = z
  .object({
    shareToken: z
      .string()
      .min(SHARE_TOKEN_MIN_LENGTH)
      .max(SHARE_TOKEN_MAX_LENGTH)
      .regex(SHARE_TOKEN_PATTERN),
    filename: z.string().min(1).max(512),
    mimeType: z.string().min(1).max(255),
    sizeBytes: z.number().int().min(1),
    status: z.enum(FILE_STATUS_VALUES),
    oneTime: z.boolean(),
    allowPreview: z.boolean(),
    expiresAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    unavailabilityMessage: z.string().min(1).optional()
  })
  .refine((data) => !(data.oneTime && data.allowPreview), {
    message: 'Preview cannot be enabled for one-time download files.',
    path: ['allowPreview']
  })
  .refine((data) => (data.status === 'expiring' ? data.expiresAt !== null : true), {
    message: 'expiring status requires expiresAt.',
    path: ['expiresAt']
  })
  .refine(
    (data) => {
      if (isPubliclyAccessible(data.status)) {
        return data.unavailabilityMessage === undefined;
      }

      return data.unavailabilityMessage !== undefined;
    },
    {
      message: 'unavailabilityMessage is required only for unavailable files.',
      path: ['unavailabilityMessage']
    }
  );

export type FileMetaResponse = z.infer<typeof fileMetaResponseSchema>;

export const downloadUrlResponseSchema = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime()
});

export type DownloadUrlResponse = z.infer<typeof downloadUrlResponseSchema>;

export const previewUrlResponseSchema = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime(),
  mimeType: z.string().min(1).max(255)
});

export type PreviewUrlResponse = z.infer<typeof previewUrlResponseSchema>;

const blockedAccessCodeByStatus: Record<
  UnavailableFileStatus,
  Set<(typeof blockedAccessCodeValues)[number]>
> = {
  pending_upload: new Set(['file_unavailable']),
  expired: new Set(['file_expired', 'file_unavailable']),
  hidden: new Set(['file_hidden', 'file_unavailable']),
  deleted: new Set(['file_deleted', 'file_unavailable']),
  consumed: new Set(['file_consumed', 'file_unavailable']),
  missing: new Set(['file_unavailable'])
};

export const blockedAccessResponseSchema = z
  .object({
    status: z.enum(UNAVAILABLE_FILE_STATUS_VALUES),
    code: z.enum(blockedAccessCodeValues),
    message: z.string().min(1),
    retryAfterSeconds: z.int().positive().optional()
  })
  .refine((data) => blockedAccessCodeByStatus[data.status].has(data.code), {
    message: 'code must be compatible with status.',
    path: ['code']
  })
  .refine(
    (data) => {
      if (data.status === 'pending_upload') {
        return data.retryAfterSeconds !== undefined;
      }

      return data.retryAfterSeconds === undefined;
    },
    {
      message: 'retryAfterSeconds is only valid for pending_upload status.',
      path: ['retryAfterSeconds']
    }
  );

export type BlockedAccessResponse = z.infer<typeof blockedAccessResponseSchema>;
