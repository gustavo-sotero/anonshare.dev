import type { FileStatus } from './file-status';
import type { ReportReason, ReportStatus } from './rules';

export const DOWNLOAD_EVENT_TYPE_VALUES = ['started', 'completed', 'failed', 'blocked'] as const;

export type DownloadEventType = (typeof DOWNLOAD_EVENT_TYPE_VALUES)[number];

export const OPERATIONAL_ANOMALY_TYPE_VALUES = [
  'missing_object',
  'orphaned_object',
  'stale_expiration',
  'failed_cleanup',
  'lifecycle_job_overdue',
  'lifecycle_job_duplicate',
  'reconciliation_scan_incomplete'
] as const;

export type OperationalAnomalyType = (typeof OPERATIONAL_ANOMALY_TYPE_VALUES)[number];

export const OPERATIONAL_ANOMALY_SEVERITY_VALUES = ['low', 'medium', 'high'] as const;

export type OperationalAnomalySeverity = (typeof OPERATIONAL_ANOMALY_SEVERITY_VALUES)[number];

export const FILE_MODERATION_ACTION_VALUES = ['hide', 'restore', 'delete'] as const;

export type FileModerationAction = (typeof FILE_MODERATION_ACTION_VALUES)[number];

export const REPORT_RESOLUTION_ACTION_VALUES = ['resolved', 'dismissed'] as const;

export type ReportResolutionAction = (typeof REPORT_RESOLUTION_ACTION_VALUES)[number];

export const SYSTEM_JOB_NAME_VALUES = [
  'expire_file',
  'cleanup_file',
  'auto_hide_file',
  'reconcile'
] as const;

export type SystemJobName = (typeof SYSTEM_JOB_NAME_VALUES)[number];

export type SharedFilePolicy = {
  allowPreview: boolean;
  oneTimeDownload: boolean;
  expiresAt: Date | null;
};

export type SharedFile = {
  id: string;
  token: string;
  objectKey: string;
  originalFilename: string;
  sanitizedFilename: string;
  mimeType: string;
  sizeBytes: number;
  status: FileStatus;
  policy: SharedFilePolicy;
  uploadedAt: Date;
  activatedAt: Date | null;
  consumedAt: Date | null;
  deletedAt: Date | null;
  reportCount: number;
};

export type DownloadEvent = {
  id: string;
  fileId: string;
  eventType: DownloadEventType;
  createdAt: Date;
  ipHash: string | null;
  context: Record<string, unknown> | null;
};

export type FileReport = {
  id: string;
  fileId: string;
  reason: ReportReason;
  message: string | null;
  status: ReportStatus;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  ipHash: string | null;
};

export type AdminSession = {
  id: string;
  githubId: string;
  githubLogin: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};

export type OperationalSetting = {
  key: string;
  value: string;
  updatedAt: Date;
};

export type OperationalAnomaly = {
  id: string;
  type: OperationalAnomalyType;
  severity: OperationalAnomalySeverity;
  fileId: string | null;
  details: Record<string, unknown> | null;
  detectedAt: Date;
  resolvedAt: Date | null;
  resolution: string | null;
};

export type FileModerationEvent = {
  id: string;
  fileId: string | null;
  action: FileModerationAction;
  previousStatus: FileStatus;
  nextStatus: FileStatus;
  actorGithubId: string;
  actorGithubLogin: string;
  reason: string | null;
  createdAt: Date;
};

export type SystemJob = {
  name: SystemJobName;
  scheduledAt: Date;
  payload: Record<string, unknown>;
};
