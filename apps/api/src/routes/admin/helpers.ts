import type { OperationalAnomalySeverity } from '@anonshare/contracts';
import type { files, reports } from '@anonshare/infrastructure/db/schema';
import type { Context } from 'hono';
import type {
  AnomalyRecord,
  DailyCountRecord,
  LifecycleQueueName,
  QueueJobHistorySample,
  QueueJobSample,
  QueueProcessingSummary
} from './types';
import {
  DEFAULT_ANOMALY_LIMIT,
  HIGH_URGENCY_REPORT_REASONS,
  LOW_URGENCY_REPORT_REASONS,
  MAX_ANOMALY_LIMIT,
  MEDIUM_URGENCY_REPORT_REASONS
} from './types';

export function setNoStoreHeaders(c: Context): void {
  c.header('cache-control', 'no-store');
}

export function getReportUrgency(
  reason: typeof reports.$inferSelect.reason
): 'low' | 'medium' | 'high' {
  switch (reason) {
    case 'illegal_content':
    case 'malware':
      return 'high';
    case 'copyright_violation':
    case 'spam':
      return 'medium';
    case 'other':
      return 'low';
  }
}

export function getReportUrgencyReasonFilter(urgency: 'low' | 'medium' | 'high') {
  switch (urgency) {
    case 'high':
      return HIGH_URGENCY_REPORT_REASONS;
    case 'medium':
      return MEDIUM_URGENCY_REPORT_REASONS;
    case 'low':
      return LOW_URGENCY_REPORT_REASONS;
  }
}

export function getFallbackSeverity(type: AnomalyRecord['type']): OperationalAnomalySeverity {
  switch (type) {
    case 'missing_object':
    case 'failed_cleanup':
    case 'reconciliation_scan_incomplete':
      return 'high';
    case 'orphaned_object':
    case 'stale_expiration':
    case 'lifecycle_job_overdue':
    case 'lifecycle_job_duplicate':
      return 'medium';
  }
}

export function getAnomalySeverity(
  type: AnomalyRecord['type'],
  details: Record<string, unknown> | null
): OperationalAnomalySeverity {
  const severity = details?.severity;

  if (severity === 'low' || severity === 'medium' || severity === 'high') {
    return severity;
  }

  return getFallbackSeverity(type);
}

export function normalizeAnomalyDetails(details: unknown): Record<string, unknown> | null {
  if (details === null || details === undefined) {
    return null;
  }

  if (typeof details === 'string') {
    try {
      return normalizeAnomalyDetails(JSON.parse(details));
    } catch {
      return { raw: details };
    }
  }

  if (Array.isArray(details)) {
    return { items: details };
  }

  if (typeof details === 'object') {
    return details as Record<string, unknown>;
  }

  return { value: details };
}

export function accessDeniedBody(
  reason: 'session_required' | 'session_expired' | 'not_allowlisted'
) {
  switch (reason) {
    case 'session_required':
      return { reason, message: 'Admin session required.' };
    case 'session_expired':
      return { reason, message: 'Admin session expired.' };
    case 'not_allowlisted':
      return { reason, message: 'GitHub account is not allowlisted.' };
  }
}

export function clampAnomalyLimit(rawLimit: string | undefined): number {
  const parsed = Number(rawLimit);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_ANOMALY_LIMIT;
  }

  return Math.min(parsed, MAX_ANOMALY_LIMIT);
}

export function computeQueueLagMs(
  waitingJobs: QueueJobSample[],
  delayedJobs: QueueJobSample[],
  nowMs: number
): number {
  const waiting = waitingJobs.at(0);
  const delayed = delayedJobs.at(0);

  const waitingLagMs =
    typeof waiting?.timestamp === 'number' ? Math.max(0, nowMs - waiting.timestamp) : 0;
  const delayedLagMs =
    typeof delayed?.timestamp === 'number'
      ? Math.max(0, nowMs - (delayed.timestamp + (delayed.delay ?? 0)))
      : 0;

  return Math.max(waitingLagMs, delayedLagMs);
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function computeQueueProcessingSummary(
  jobs: QueueJobHistorySample[]
): QueueProcessingSummary {
  if (jobs.length === 0) {
    return {
      sampledJobs: 0,
      retriedJobs: 0,
      retryRate: 0,
      avgAttemptsMade: 0,
      avgDurationMs: null,
      p95DurationMs: null
    };
  }

  let attemptsTotal = 0;
  let retriedJobs = 0;
  const durationsMs: number[] = [];

  for (const job of jobs) {
    const attemptsMade = Math.max(0, job.attemptsMade ?? 0);
    attemptsTotal += attemptsMade;
    if (attemptsMade > 0) {
      retriedJobs += 1;
    }

    if (typeof job.processedOn === 'number' && typeof job.finishedOn === 'number') {
      durationsMs.push(Math.max(0, job.finishedOn - job.processedOn));
    }
  }

  durationsMs.sort((left, right) => left - right);

  const avgDurationMs =
    durationsMs.length > 0
      ? Math.round(durationsMs.reduce((sum, duration) => sum + duration, 0) / durationsMs.length)
      : null;

  const p95DurationMs =
    durationsMs.length > 0
      ? (durationsMs[Math.max(0, Math.ceil(durationsMs.length * 0.95) - 1)] ?? null)
      : null;

  return {
    sampledJobs: jobs.length,
    retriedJobs,
    retryRate: roundTo(retriedJobs / jobs.length, 4),
    avgAttemptsMade: roundTo(attemptsTotal / jobs.length, 2),
    avgDurationMs,
    p95DurationMs
  };
}

export function normalizeQueueName(name: string): LifecycleQueueName {
  switch (name) {
    case 'expire-file':
    case 'cleanup-file':
    case 'reconcile':
      return name;
    default:
      throw new Error(`Unsupported lifecycle queue: ${name}`);
  }
}

export function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function formatUtcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function buildDailySeries(
  rows: DailyCountRecord[],
  startInclusiveUtc: Date,
  windowDays: number
): DailyCountRecord[] {
  const byDay = new Map(rows.map((row) => [row.day, row.count]));
  const series: DailyCountRecord[] = [];

  for (let dayOffset = 0; dayOffset < windowDays; dayOffset += 1) {
    const currentDay = new Date(startInclusiveUtc);
    currentDay.setUTCDate(startInclusiveUtc.getUTCDate() + dayOffset);
    const day = formatUtcDay(currentDay);

    series.push({ day, count: byDay.get(day) ?? 0 });
  }

  return series;
}

export function resolveRestoredFileStatus(params: {
  file: typeof files.$inferSelect;
  latestHiddenPreviousStatus: typeof files.$inferSelect.status | null;
  now: Date;
}): typeof files.$inferSelect.status {
  const { file, latestHiddenPreviousStatus, now } = params;

  if (file.expiresAt && file.expiresAt <= now) {
    return 'expired';
  }

  if (
    latestHiddenPreviousStatus === 'pending_upload' ||
    latestHiddenPreviousStatus === 'active' ||
    latestHiddenPreviousStatus === 'expiring' ||
    latestHiddenPreviousStatus === 'expired' ||
    latestHiddenPreviousStatus === 'consumed' ||
    latestHiddenPreviousStatus === 'missing'
  ) {
    return latestHiddenPreviousStatus;
  }

  if (file.consumedAt !== null) {
    return 'consumed';
  }

  if (file.activatedAt === null) {
    return 'pending_upload';
  }

  return 'active';
}
