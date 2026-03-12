import {
  FILE_MODERATION_ACTION_VALUES,
  OPERATIONAL_ANOMALY_SEVERITY_VALUES,
  OPERATIONAL_ANOMALY_TYPE_VALUES,
  REPORT_RESOLUTION_ACTION_VALUES
} from '@anonshare/domain';
import { z } from 'zod';
import { GITHUB_ID_MAX_LENGTH, GITHUB_LOGIN_MAX_LENGTH } from './constants';
import { QUEUE_CLEANUP_FILE, QUEUE_EXPIRE_FILE, QUEUE_RECONCILE } from './jobs';

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

export const operationalAnomalySeveritySchema = z.enum(OPERATIONAL_ANOMALY_SEVERITY_VALUES);

export type OperationalAnomalySeverity = z.infer<typeof operationalAnomalySeveritySchema>;

export const operationalAnomalySummarySchema = z.object({
  id: z.uuid(),
  type: z.enum(OPERATIONAL_ANOMALY_TYPE_VALUES),
  severity: operationalAnomalySeveritySchema,
  fileId: z.uuid().nullable(),
  details: z.record(z.string(), z.unknown()).nullable(),
  detectedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  resolution: z.string().nullable()
});

export type OperationalAnomalySummary = z.infer<typeof operationalAnomalySummarySchema>;

export const queueHealthSnapshotSchema = z.object({
  queue: z.enum([QUEUE_EXPIRE_FILE, QUEUE_CLEANUP_FILE, QUEUE_RECONCILE]),
  status: z.enum(['healthy', 'degraded']),
  lastError: z.string().min(1).nullable(),
  waiting: z.int().min(0),
  active: z.int().min(0),
  delayed: z.int().min(0),
  failed: z.int().min(0),
  completed: z.int().min(0),
  lagMs: z.int().min(0),
  processing: z.object({
    sampledJobs: z.int().min(0),
    retriedJobs: z.int().min(0),
    retryRate: z.number().min(0).max(1),
    avgAttemptsMade: z.number().min(0),
    avgDurationMs: z.int().min(0).nullable(),
    p95DurationMs: z.int().min(0).nullable()
  })
});

export type QueueHealthSnapshot = z.infer<typeof queueHealthSnapshotSchema>;

export const adminLifecycleStatsResponseSchema = z.object({
  openAnomaliesTotal: z.int().min(0),
  openAnomaliesByType: z.record(z.string(), z.int().min(0)),
  queueHealth: z.array(queueHealthSnapshotSchema)
});

export type AdminLifecycleStatsResponse = z.infer<typeof adminLifecycleStatsResponseSchema>;

export const adminAnomaliesResponseSchema = z.object({
  anomalies: z.array(operationalAnomalySummarySchema)
});

export type AdminAnomaliesResponse = z.infer<typeof adminAnomaliesResponseSchema>;
