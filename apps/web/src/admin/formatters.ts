import type {
  AdminFileDetail,
  AdminFileSummary,
  AdminReportSummary,
  OperationalAnomalySummary,
  QueueHealthSnapshot
} from '@anonshare/contracts';

// ─── Date/Time ───────────────────────────────────────────────────────────────

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
});

export function formatDateTime(value: string): string {
  return dateTimeFormatter.format(new Date(value));
}

export function formatOptionalDateTime(value: string | null): string {
  return value ? formatDateTime(value) : 'n/a';
}

// ─── Numeric ─────────────────────────────────────────────────────────────────

export function formatLag(lagMs: number): string {
  if (lagMs < 1_000) return `${lagMs} ms`;
  if (lagMs < 60_000) return `${(lagMs / 1_000).toFixed(1)} s`;
  return `${(lagMs / 60_000).toFixed(1)} min`;
}

export function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return 'n/a';
  return formatLag(durationMs);
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${formatCount(value)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = -1;
  do {
    size /= 1024;
    unitIndex += 1;
  } while (size >= 1024 && unitIndex < units.length - 1);
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: size >= 100 ? 0 : 1 }).format(size)} ${units[unitIndex]}`;
}

// ─── Domain labels ───────────────────────────────────────────────────────────

export function formatAnomalyType(type: OperationalAnomalySummary['type']): string {
  return type.replaceAll('_', ' ');
}

export function formatReportReason(reason: AdminReportSummary['reason']): string {
  return reason.replaceAll('_', ' ');
}

export function formatReportUrgency(urgency: AdminReportSummary['urgency']): string {
  return urgency[0]?.toUpperCase() + urgency.slice(1);
}

export function formatFileStatus(status: AdminFileSummary['status']): string {
  return status.replaceAll('_', ' ');
}

export function formatModerationTransition(previousStatus: string, nextStatus: string): string {
  return `${formatFileStatus(previousStatus as AdminFileSummary['status'])} → ${formatFileStatus(nextStatus as AdminFileSummary['status'])}`;
}

export function formatStorageObjectStatus(
  status: AdminFileDetail['storageObject']['status']
): string {
  switch (status) {
    case 'present':
      return 'Present';
    case 'missing':
      return 'Missing';
    case 'unknown':
      return 'Check failed';
  }
}

export function summarizeQueueState(queue: QueueHealthSnapshot): string {
  if (queue.status === 'degraded') return 'Degraded';
  if (queue.failed > 0) return 'Needs attention';
  if (queue.active > 0 || queue.waiting > 0) return 'Working';
  if (queue.delayed > 0) return 'Scheduled';
  return 'Idle';
}

export function formatDetailValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return 'n/a';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function getAnomalyDetails(details: OperationalAnomalySummary['details']) {
  return Object.entries(details ?? {})
    .filter(([key]) => key !== 'severity' && key !== 'fingerprint')
    .slice(0, 4);
}
