/** Only treat a pending_upload as "stuck" once it is older than this threshold. */
export const PENDING_UPLOAD_STALE_THRESHOLD_MS = 10 * 60 * 1_000; // 10 minutes

/**
 * Only record a stale_expiration anomaly when the file is significantly overdue.
 * Files caught in the same reconcile window do not generate noise anomalies.
 */
export const STALE_EXPIRATION_ANOMALY_THRESHOLD_MS = 2 * 60 * 60 * 1_000; // 2 hours

/** Max number of stale expirations fixed per reconcile run. */
export const STALE_EXPIRATION_BATCH_SIZE = 200;

/**
 * Max number of active/expiring files checked for missing storage objects per run.
 * Scan the oldest first; subsequent runs advance the window via cursor.
 */
export const MISSING_OBJECT_BATCH_SIZE = 50;

/** Max number of stuck pending_upload records resolved per reconcile run. */
export const STUCK_PENDING_BATCH_SIZE = 100;

/** Max number of future expirations checked for missing delayed jobs per run. */
export const FUTURE_EXPIRATION_BATCH_SIZE = 100;

/** Max number of terminal records checked for missing cleanup jobs per run. */
export const TERMINAL_CLEANUP_BATCH_SIZE = 100;

/** Max number of storage objects scanned for orphan detection per run. */
export const ORPHANED_OBJECT_BATCH_SIZE = 100;

/**
 * Consider pending lifecycle jobs as abnormally delayed once their scheduled
 * execution time is older than this threshold.
 */
export const LIFECYCLE_JOB_OVERDUE_THRESHOLD_MS = 10 * 60 * 1_000; // 10 minutes
export const LIFECYCLE_DUPLICATE_SCAN_LIMIT = 200;
export const LIFECYCLE_QUEUE_READ_TIMEOUT_MS = 3_000;

export const STORAGE_OBJECT_PREFIX = 'objects/';

export const FUTURE_EXPIRATION_CURSOR_SETTING_KEY = 'reconcile_future_expire_cursor';
export const MISSING_OBJECT_CURSOR_SETTING_KEY = 'reconcile_missing_object_cursor';
export const TERMINAL_CLEANUP_CURSOR_SETTING_KEY = 'reconcile_terminal_cleanup_cursor';
export const ORPHAN_SCAN_CURSOR_SETTING_KEY = 'reconcile_orphan_scan_cursor';

export class QueueReadTimeoutError extends Error {
  constructor(queueName: string, operation: string, timeoutMs: number) {
    super(`${queueName} ${operation} timed out after ${timeoutMs}ms`);
    this.name = 'QueueReadTimeoutError';
  }
}

export const PENDING_QUEUE_JOB_STATES = new Set([
  'waiting',
  'active',
  'delayed',
  'prioritized',
  'waiting-children'
]);
