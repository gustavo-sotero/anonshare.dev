import {
  adminSessions,
  downloadEvents,
  fileModerationActions,
  files,
  operationalAnomalies,
  reports
} from '@anonshare/infrastructure/db/schema';
import {
  listRateLimitBlockedCountsByDay,
  RATE_LIMIT_BLOCKED_METRIC_SURFACES
} from '@anonshare/infrastructure/rate-limit';
import { getRedisClient } from '@anonshare/infrastructure/redis';
import { and, asc, desc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  enqueueCleanupFileJob,
  getCleanupQueue,
  getExpireQueue,
  getReconcileQueue
} from '../../queues';
import { getDb } from '../support';
import type {
  AnomalyCountRecord,
  AnomalyRecord,
  DailyCountRecord,
  DownloadCountRecord,
  FileStatusCountRecord,
  QueueStatsReader,
  ReportStatusCountRecord,
  SessionRecord
} from './types';

export async function defaultFindSessionById(sessionId: string): Promise<SessionRecord | null> {
  const session = await getDb().query.adminSessions.findFirst({
    where: eq(adminSessions.id, sessionId)
  });

  return session ?? null;
}

export async function defaultListAnomalies(limit: number): Promise<AnomalyRecord[]> {
  return getDb()
    .select({
      id: operationalAnomalies.id,
      type: operationalAnomalies.type,
      fileId: operationalAnomalies.fileId,
      details: operationalAnomalies.details,
      detectedAt: operationalAnomalies.detectedAt,
      resolvedAt: operationalAnomalies.resolvedAt,
      resolution: operationalAnomalies.resolution
    })
    .from(operationalAnomalies)
    .where(isNull(operationalAnomalies.resolvedAt))
    .orderBy(desc(operationalAnomalies.detectedAt))
    .limit(limit);
}

export async function defaultListOpenAnomalyCounts(): Promise<AnomalyCountRecord[]> {
  return getDb()
    .select({
      type: operationalAnomalies.type,
      count: sql<number>`count(*)::int`
    })
    .from(operationalAnomalies)
    .where(isNull(operationalAnomalies.resolvedAt))
    .groupBy(operationalAnomalies.type);
}

export async function defaultListReportStatusCounts(): Promise<ReportStatusCountRecord[]> {
  return getDb()
    .select({
      status: reports.status,
      count: sql<number>`count(*)::int`
    })
    .from(reports)
    .groupBy(reports.status);
}

export async function defaultListReportCountsByDay(
  startInclusiveUtc: Date
): Promise<DailyCountRecord[]> {
  const dayBucket = sql<string>`to_char(date_trunc('day', timezone('UTC', ${reports.createdAt})), 'YYYY-MM-DD')`;

  return getDb()
    .select({
      day: dayBucket,
      count: sql<number>`count(*)::int`
    })
    .from(reports)
    .where(gte(reports.createdAt, startInclusiveUtc))
    .groupBy(dayBucket)
    .orderBy(asc(dayBucket));
}

export async function defaultListAutoHiddenCountsByDay(
  startInclusiveUtc: Date
): Promise<DailyCountRecord[]> {
  const dayBucket = sql<string>`to_char(date_trunc('day', timezone('UTC', ${fileModerationActions.createdAt})), 'YYYY-MM-DD')`;

  return getDb()
    .select({
      day: dayBucket,
      count: sql<number>`count(*)::int`
    })
    .from(fileModerationActions)
    .where(
      and(
        eq(fileModerationActions.action, 'hide'),
        eq(fileModerationActions.actorGithubLogin, 'system:auto_hide'),
        gte(fileModerationActions.createdAt, startInclusiveUtc)
      )
    )
    .groupBy(dayBucket)
    .orderBy(asc(dayBucket));
}

export async function defaultListResolvedReportCountsByDay(
  startInclusiveUtc: Date
): Promise<DailyCountRecord[]> {
  const dayBucket = sql<string>`to_char(date_trunc('day', timezone('UTC', ${reports.resolvedAt})), 'YYYY-MM-DD')`;

  return getDb()
    .select({
      day: dayBucket,
      count: sql<number>`count(*)::int`
    })
    .from(reports)
    .where(
      and(
        eq(reports.status, 'resolved'),
        isNotNull(reports.resolvedAt),
        gte(reports.resolvedAt, startInclusiveUtc)
      )
    )
    .groupBy(dayBucket)
    .orderBy(asc(dayBucket));
}

export async function defaultListDismissedReportCountsByDay(
  startInclusiveUtc: Date
): Promise<DailyCountRecord[]> {
  const dayBucket = sql<string>`to_char(date_trunc('day', timezone('UTC', ${reports.resolvedAt})), 'YYYY-MM-DD')`;

  return getDb()
    .select({
      day: dayBucket,
      count: sql<number>`count(*)::int`
    })
    .from(reports)
    .where(
      and(
        eq(reports.status, 'dismissed'),
        isNotNull(reports.resolvedAt),
        gte(reports.resolvedAt, startInclusiveUtc)
      )
    )
    .groupBy(dayBucket)
    .orderBy(asc(dayBucket));
}

export async function defaultListRateLimitBlockedCountsByDay(
  startInclusiveUtc: Date,
  windowDays: number
): Promise<DailyCountRecord[]> {
  return listRateLimitBlockedCountsByDay(
    getRedisClient(),
    RATE_LIMIT_BLOCKED_METRIC_SURFACES,
    startInclusiveUtc,
    windowDays
  );
}

export async function defaultListFileStatusCounts(): Promise<FileStatusCountRecord[]> {
  return getDb()
    .select({
      status: files.status,
      count: sql<number>`count(*)::int`,
      totalSizeBytes: sql<number>`coalesce(sum(${files.sizeBytes}), 0)::bigint::int8`
    })
    .from(files)
    .groupBy(files.status);
}

export async function defaultGetDownloadCounts(): Promise<DownloadCountRecord> {
  const [row] = await getDb()
    .select({
      totalDownloads: sql<number>`count(*)::int`
    })
    .from(downloadEvents)
    .where(eq(downloadEvents.eventType, 'completed'));

  return { totalDownloads: row?.totalDownloads ?? 0 };
}

export function defaultGetQueues(): QueueStatsReader[] {
  return [getExpireQueue(), getCleanupQueue(), getReconcileQueue()];
}

export { enqueueCleanupFileJob };
