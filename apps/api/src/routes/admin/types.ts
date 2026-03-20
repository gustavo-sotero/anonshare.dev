import type { createDb } from '@anonshare/infrastructure/db';
import type { files, operationalAnomalies, reports } from '@anonshare/infrastructure/db/schema';
import type { StorageHeadObject } from '@anonshare/infrastructure/storage';

// ─── Constants ────────────────────────────────────────────────────────────────

export const ADMIN_SESSION_COOKIE_NAME = 'anonshare_admin_session';
export const DEFAULT_ANOMALY_LIMIT = 50;
export const MAX_ANOMALY_LIMIT = 200;
export const DAY_IN_MS = 24 * 60 * 60 * 1000;
export const FILE_DETAIL_REPORT_LIMIT = 100;
export const FILE_DETAIL_MODERATION_HISTORY_LIMIT = 100;
export const QUEUE_READ_TIMEOUT_MS = 3_000;
export const ABUSE_METRICS_WINDOW_DAYS = 14;

export const HIGH_URGENCY_REPORT_REASONS = ['illegal_content', 'malware'] as const;
export const MEDIUM_URGENCY_REPORT_REASONS = ['copyright_violation', 'spam'] as const;
export const LOW_URGENCY_REPORT_REASONS = ['other'] as const;

// ─── Record types ─────────────────────────────────────────────────────────────

export type LifecycleQueueName = 'expire-file' | 'cleanup-file' | 'reconcile';

export type SessionRecord = {
  id: string;
  githubId: string;
  githubLogin: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

export type AnomalyRecord = {
  id: string;
  type: typeof operationalAnomalies.$inferSelect.type;
  fileId: string | null;
  details: unknown;
  detectedAt: Date;
  resolvedAt: Date | null;
  resolution: string | null;
};

export type AnomalyCountRecord = {
  type: typeof operationalAnomalies.$inferSelect.type;
  count: number;
};

export type ReportStatusCountRecord = {
  status: typeof reports.$inferSelect.status;
  count: number;
};

export type DailyCountRecord = {
  day: string;
  count: number;
};

export type FileStatusCountRecord = {
  status: typeof files.$inferSelect.status;
  count: number;
  totalSizeBytes: number;
};

export type DownloadCountRecord = {
  totalDownloads: number;
};

// ─── Queue types ──────────────────────────────────────────────────────────────

export type QueueJobSample = {
  timestamp?: number;
  delay?: number;
};

export type QueueJobHistorySample = {
  attemptsMade?: number;
  processedOn?: number;
  finishedOn?: number;
};

export type QueueProcessingSummary = {
  sampledJobs: number;
  retriedJobs: number;
  retryRate: number;
  avgAttemptsMade: number;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
};

export type QueueHealthStatus = 'healthy' | 'degraded';

export type QueueStatsReader = {
  name: string;
  getJobCounts(): Promise<Record<string, number>>;
  getWaiting(start: number, end: number): Promise<QueueJobSample[]>;
  getDelayed(start: number, end: number): Promise<QueueJobSample[]>;
  getJobs(
    types: Array<'completed' | 'failed'>,
    start: number,
    end: number,
    asc?: boolean
  ): Promise<QueueJobHistorySample[]>;
};

// ─── Dependency injection ─────────────────────────────────────────────────────

export type AdminRouterDeps = {
  findSessionById?: (sessionId: string) => Promise<SessionRecord | null>;
  listAnomalies?: (limit: number) => Promise<AnomalyRecord[]>;
  listOpenAnomalyCounts?: () => Promise<AnomalyCountRecord[]>;
  listReportStatusCounts?: () => Promise<ReportStatusCountRecord[]>;
  listReportCountsByDay?: (startInclusiveUtc: Date) => Promise<DailyCountRecord[]>;
  listAutoHiddenCountsByDay?: (startInclusiveUtc: Date) => Promise<DailyCountRecord[]>;
  listResolvedReportCountsByDay?: (startInclusiveUtc: Date) => Promise<DailyCountRecord[]>;
  listDismissedReportCountsByDay?: (startInclusiveUtc: Date) => Promise<DailyCountRecord[]>;
  listRateLimitBlockedCountsByDay?: (
    startInclusiveUtc: Date,
    windowDays: number
  ) => Promise<DailyCountRecord[]>;
  listFileStatusCounts?: () => Promise<FileStatusCountRecord[]>;
  getDownloadCounts?: () => Promise<DownloadCountRecord>;
  getAllowedGithubUserId?: () => string;
  getQueues?: () => QueueStatsReader[];
  headStorageObject?: (objectKey: string) => Promise<StorageHeadObject | null>;
  now?: () => Date;
  enqueueCleanupFile?: (fileId: string, objectKey: string, delayMs?: number) => Promise<void>;
  getDb?: () => ReturnType<typeof createDb>;
};
