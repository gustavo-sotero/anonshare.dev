import {
  DOWNLOAD_EVENT_TYPE_VALUES,
  FILE_MODERATION_ACTION_VALUES,
  FILE_STATUS_VALUES,
  OPERATIONAL_ANOMALY_SEVERITY_VALUES,
  OPERATIONAL_ANOMALY_TYPE_VALUES,
  REPORT_REASON_VALUES,
  REPORT_RESOLUTION_ACTION_VALUES,
  REPORT_STATUS_VALUES
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

export const reportTotalsByStatusSchema = z.object({
  pending: z.int().min(0),
  resolved: z.int().min(0),
  dismissed: z.int().min(0)
});

export const adminReportTotalsSchema = z.object({
  total: z.int().min(0),
  byStatus: reportTotalsByStatusSchema
});

export const adminDailyCountSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  count: z.int().min(0)
});

export const adminAbuseMetricsSchema = z.object({
  windowDays: z.int().min(1),
  reportsByDay: z.array(adminDailyCountSchema),
  autoHiddenByDay: z.array(adminDailyCountSchema),
  resolvedReportsByDay: z.array(adminDailyCountSchema),
  dismissedReportsByDay: z.array(adminDailyCountSchema),
  rateLimitBlockedByDay: z.array(adminDailyCountSchema)
});

export const adminLifecycleStatsResponseSchema = z.object({
  openAnomaliesTotal: z.int().min(0),
  openAnomaliesByType: z.record(z.string(), z.int().min(0)),
  reportTotals: adminReportTotalsSchema,
  abuseMetrics: adminAbuseMetricsSchema,
  queueHealth: z.array(queueHealthSnapshotSchema)
});

export type AdminLifecycleStatsResponse = z.infer<typeof adminLifecycleStatsResponseSchema>;

export const adminAnomaliesResponseSchema = z.object({
  anomalies: z.array(operationalAnomalySummarySchema)
});

export type AdminAnomaliesResponse = z.infer<typeof adminAnomaliesResponseSchema>;

// ─── File management ──────────────────────────────────────────────────────────

export const adminFileSummarySchema = z.object({
  id: z.uuid(),
  token: z.string().min(1),
  sanitizedFilename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number(),
  status: z.enum(FILE_STATUS_VALUES),
  reportCount: z.int().min(0),
  allowPreview: z.boolean(),
  oneTimeDownload: z.boolean(),
  expiresAt: z.iso.datetime().nullable(),
  uploadedAt: z.iso.datetime(),
  activatedAt: z.iso.datetime().nullable(),
  consumedAt: z.iso.datetime().nullable(),
  deletedAt: z.iso.datetime().nullable()
});

export type AdminFileSummary = z.infer<typeof adminFileSummarySchema>;

export const adminFileListResponseSchema = z.object({
  files: z.array(adminFileSummarySchema),
  total: z.int().min(0),
  page: z.int().min(1),
  pageSize: z.int().min(1)
});

export type AdminFileListResponse = z.infer<typeof adminFileListResponseSchema>;

export const adminModerationActionSummarySchema = z.object({
  id: z.uuid(),
  action: z.enum(FILE_MODERATION_ACTION_VALUES),
  previousStatus: z.enum(FILE_STATUS_VALUES),
  nextStatus: z.enum(FILE_STATUS_VALUES),
  actorGithubLogin: z.string().min(1),
  reason: z.string().nullable(),
  createdAt: z.iso.datetime()
});

export type AdminModerationActionSummary = z.infer<typeof adminModerationActionSummarySchema>;

export const ADMIN_REPORT_URGENCY_VALUES = ['low', 'medium', 'high'] as const;

export type AdminReportUrgency = (typeof ADMIN_REPORT_URGENCY_VALUES)[number];

export const adminReportSummarySchema = z.object({
  id: z.uuid(),
  fileId: z.uuid(),
  reason: z.enum(REPORT_REASON_VALUES),
  urgency: z.enum(ADMIN_REPORT_URGENCY_VALUES),
  message: z.string().nullable(),
  status: z.enum(REPORT_STATUS_VALUES),
  resolvedBy: z.string().nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime()
});

export type AdminReportSummary = z.infer<typeof adminReportSummarySchema>;

export const ADMIN_FILE_POLICY_VALUES = ['standard', 'one_time', 'preview_enabled'] as const;

export type AdminFilePolicyFilter = (typeof ADMIN_FILE_POLICY_VALUES)[number];

export const ADMIN_FILE_SORT_VALUES = [
  'uploadedAt_desc',
  'sizeBytes_desc',
  'reportCount_desc'
] as const;
export type AdminFileSort = (typeof ADMIN_FILE_SORT_VALUES)[number];

export const adminFileListQuerySchema = z.object({
  status: z.enum(FILE_STATUS_VALUES).optional(),
  policy: z.enum(ADMIN_FILE_POLICY_VALUES).optional(),
  sortBy: z.enum(ADMIN_FILE_SORT_VALUES).optional().default('uploadedAt_desc'),
  uploadedWithinDays: z.coerce.number().int().min(1).max(365).optional(),
  minReportCount: z.coerce.number().int().min(0).max(10_000).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50)
});

export type AdminFileListQuery = z.infer<typeof adminFileListQuerySchema>;

export const moderationResultSchema = z.object({
  fileId: z.uuid(),
  previousStatus: z.enum(FILE_STATUS_VALUES),
  nextStatus: z.enum(FILE_STATUS_VALUES)
});

export type ModerationResult = z.infer<typeof moderationResultSchema>;

export const adminReportListResponseSchema = z.object({
  reports: z.array(adminReportSummarySchema),
  total: z.int().min(0),
  page: z.int().min(1),
  pageSize: z.int().min(1)
});

export type AdminReportListResponse = z.infer<typeof adminReportListResponseSchema>;

export const adminReportListQuerySchema = z.object({
  status: z.enum(REPORT_STATUS_VALUES).optional(),
  fileId: z.uuid().optional(),
  reason: z.enum(REPORT_REASON_VALUES).optional(),
  urgency: z.enum(ADMIN_REPORT_URGENCY_VALUES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50)
});

export type AdminReportListQuery = z.infer<typeof adminReportListQuerySchema>;

// ─── Overview (file counts, storage, downloads) ──────────────────────────────

export const adminOverviewResponseSchema = z.object({
  totalFiles: z.int().min(0),
  byStatus: z.record(z.string(), z.int().min(0)),
  totalStorageBytes: z.number().min(0),
  totalDownloads: z.int().min(0)
});

export type AdminOverviewResponse = z.infer<typeof adminOverviewResponseSchema>;

// ─── Download activity ───────────────────────────────────────────────────────

export const adminDownloadEventSummarySchema = z.object({
  id: z.uuid(),
  fileId: z.uuid(),
  eventType: z.enum(DOWNLOAD_EVENT_TYPE_VALUES),
  createdAt: z.iso.datetime(),
  ipHash: z.string().nullable()
});

export type AdminDownloadEventSummary = z.infer<typeof adminDownloadEventSummarySchema>;

export const adminDownloadListResponseSchema = z.object({
  downloads: z.array(adminDownloadEventSummarySchema),
  total: z.int().min(0),
  page: z.int().min(1),
  pageSize: z.int().min(1)
});

export type AdminDownloadListResponse = z.infer<typeof adminDownloadListResponseSchema>;

export const adminStorageObjectStateSchema = z.object({
  objectKey: z.string().min(1),
  status: z.enum(['present', 'missing', 'unknown']),
  contentLength: z.number().min(0).nullable(),
  contentType: z.string().min(1).nullable(),
  checkedAt: z.iso.datetime(),
  error: z.string().min(1).nullable()
});

export type AdminStorageObjectState = z.infer<typeof adminStorageObjectStateSchema>;

export const adminFileDownloadActivitySchema = z.object({
  total: z.int().min(0),
  recent: z.array(adminDownloadEventSummarySchema)
});

export type AdminFileDownloadActivity = z.infer<typeof adminFileDownloadActivitySchema>;

export const adminFileDetailSchema = adminFileSummarySchema.extend({
  storageObject: adminStorageObjectStateSchema,
  downloadActivity: adminFileDownloadActivitySchema,
  reports: z.array(adminReportSummarySchema),
  moderationHistory: z.array(adminModerationActionSummarySchema)
});

export type AdminFileDetail = z.infer<typeof adminFileDetailSchema>;

export const adminFileDetailResponseSchema = z.object({
  file: adminFileDetailSchema
});

export type AdminFileDetailResponse = z.infer<typeof adminFileDetailResponseSchema>;
