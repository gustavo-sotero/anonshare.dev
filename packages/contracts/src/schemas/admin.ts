import { FILE_MODERATION_ACTION_VALUES, REPORT_RESOLUTION_ACTION_VALUES } from '@anonshare/domain';
import { z } from 'zod';
import { GITHUB_ID_MAX_LENGTH, GITHUB_LOGIN_MAX_LENGTH } from './constants';

/**
 * Schemas for admin-only moderation actions and dashboard operations.
 * All routes consuming these schemas must be protected by admin session middleware.
 */

export const moderationActionSchema = z.object({
  action: z.enum(FILE_MODERATION_ACTION_VALUES),
  /** Optional internal note recorded alongside the action. */
  reason: z.string().max(500).optional()
});

export type ModerationAction = z.infer<typeof moderationActionSchema>;

export const resolveReportSchema = z.object({
  action: z.enum(REPORT_RESOLUTION_ACTION_VALUES)
});

export type ResolveReportAction = z.infer<typeof resolveReportSchema>;

export const adminLoginStartResponseSchema = z.object({
  authorizationUrl: z.url(),
  state: z.string().min(1)
});

export type AdminLoginStartResponse = z.infer<typeof adminLoginStartResponseSchema>;

export const adminSessionSchema = z.object({
  id: z.uuid(),
  githubId: z.string().min(1).max(GITHUB_ID_MAX_LENGTH).regex(/^\d+$/),
  githubLogin: z.string().min(1).max(GITHUB_LOGIN_MAX_LENGTH),
  expiresAt: z.iso.datetime()
});

export type AdminSession = z.infer<typeof adminSessionSchema>;

export const adminSessionResponseSchema = z
  .object({
    authenticated: z.boolean(),
    session: adminSessionSchema.nullable()
  })
  .refine((data) => (data.authenticated ? data.session !== null : data.session === null), {
    message: 'session must exist only when authenticated is true.',
    path: ['session']
  });

export type AdminSessionResponse = z.infer<typeof adminSessionResponseSchema>;

export const accessDeniedResponseSchema = z.object({
  reason: z.enum(['session_required', 'session_expired', 'not_allowlisted']),
  message: z.string().min(1)
});

export type AccessDeniedResponse = z.infer<typeof accessDeniedResponseSchema>;

export const adminLoginCallbackSchema = z.object({
  /** GitHub OAuth authorization code from the callback query parameter. */
  code: z.string().min(1),
  /** State token echoed back by GitHub; validated against the session store. */
  state: z.string().min(1)
});

export type AdminLoginCallback = z.infer<typeof adminLoginCallbackSchema>;
