import { MAX_FILE_SIZE_BYTES, validateUploadPolicy } from '@anonshare/domain';
import { z } from 'zod';
import { SHARE_TOKEN_MAX_LENGTH, SHARE_TOKEN_MIN_LENGTH, SHARE_TOKEN_PATTERN } from './constants';

/**
 * Validates the multipart metadata sent alongside a file upload.
 *
 * Invariants enforced:
 *  - One-time download and allow-preview are mutually exclusive (PRD §4).
 *  - Expiration, when set, must not exceed MAX_EXPIRATION_DAYS from now.
 */
export const uploadRequestSchema = z
  .object({
    filename: z.string().min(1).max(512),
    mimeType: z.string().min(1).max(255),
    sizeBytes: z.number().int().min(1).max(MAX_FILE_SIZE_BYTES),
    oneTime: z.boolean(),
    allowPreview: z.boolean(),
    /** ISO-8601 datetime string, or null for no expiration. */
    expiresAt: z.iso.datetime().nullable()
  })
  .superRefine((data, ctx) => {
    const result = validateUploadPolicy({
      oneTime: data.oneTime,
      allowPreview: data.allowPreview,
      expiresAt: data.expiresAt === null ? null : new Date(data.expiresAt)
    });

    for (const issue of result.issues) {
      ctx.addIssue({
        code: 'custom',
        message: issue.message,
        path: [issue.path]
      });
    }
  });

export type UploadRequest = z.infer<typeof uploadRequestSchema>;

export const uploadResponseSchema = z.object({
  shareToken: z
    .string()
    .min(SHARE_TOKEN_MIN_LENGTH)
    .max(SHARE_TOKEN_MAX_LENGTH)
    .regex(SHARE_TOKEN_PATTERN),
  shareUrl: z.url(),
  expiresAt: z.iso.datetime().nullable()
});

export type UploadResponse = z.infer<typeof uploadResponseSchema>;
