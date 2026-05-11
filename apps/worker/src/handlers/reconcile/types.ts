import type { CleanupFileJobPayload, ExpireFileJobPayload } from '@anonshare/contracts';
import type { createDb } from '@anonshare/infrastructure/db';
import type { storageAdapter } from '@anonshare/infrastructure/storage';
import type { Queue } from 'bullmq';

export type ReconcileHandlerDeps = {
  db: ReturnType<typeof createDb>;
  storage: Pick<typeof storageAdapter, 'exists' | 'list'>;
  cleanupQueue: Queue<CleanupFileJobPayload>;
  expireQueue: Queue<ExpireFileJobPayload>;
  getFutureExpirationCursor?: () => Promise<string | undefined>;
  setFutureExpirationCursor?: (cursor: string | null) => Promise<void>;
  getMissingObjectCursor?: () => Promise<string | undefined>;
  setMissingObjectCursor?: (cursor: string | null) => Promise<void>;
  getTerminalCleanupCursor?: () => Promise<string | undefined>;
  setTerminalCleanupCursor?: (cursor: string | null) => Promise<void>;
  getOrphanScanCursor?: () => Promise<string | undefined>;
  setOrphanScanCursor?: (cursor: string | null) => Promise<void>;
};

/**
 * Resolved version of `ReconcileHandlerDeps` with all optional cursor helpers
 * made required and `olderThan` included. Passed down to individual pass
 * functions after the orchestrator resolves defaults.
 */
export type ReconcileResolvedDeps = {
  db: ReturnType<typeof createDb>;
  storage: Pick<typeof storageAdapter, 'exists' | 'list'>;
  cleanupQueue: Queue<CleanupFileJobPayload>;
  expireQueue: Queue<ExpireFileJobPayload>;
  getFutureExpirationCursor: () => Promise<string | undefined>;
  setFutureExpirationCursor: (cursor: string | null) => Promise<void>;
  getMissingObjectCursor: () => Promise<string | undefined>;
  setMissingObjectCursor: (cursor: string | null) => Promise<void>;
  getTerminalCleanupCursor: () => Promise<string | undefined>;
  setTerminalCleanupCursor: (cursor: string | null) => Promise<void>;
  getOrphanScanCursor: () => Promise<string | null | undefined>;
  setOrphanScanCursor: (cursor: string | null) => Promise<void>;
  olderThan: Date;
};

/** Mutable counters accumulated during a reconcile run across all passes. */
export type ReconcileCounters = {
  staleExpirationsFixed: number;
  expireJobsRepaired: number;
  pendingUploadsPromoted: number;
  pendingUploadsRemoved: number;
  missingObjectsDetected: number;
  terminalCleanupEnqueued: number;
  storageCheckFailures: number;
  orphanScanFailures: number;
  orphanedObjectsDetected: number;
  lifecycleDuplicateJobGroups: number;
  lifecycleDuplicateJobs: number;
  lifecycleQueueScanFailures: number;
  lifecycleQueueReadFailures: number;
  anomaliesRecorded: number;
};

export type ReconcileStorageFailurePhase =
  | 'stuck_pending'
  | 'missing_object'
  | 'terminal_cleanup'
  | 'orphaned_object_scan';

export type LifecycleRepairQueue = 'expire-file' | 'cleanup-file';

export type QueueLookupResult<T> = { ok: true; value: T } | { ok: false; anomalyRecorded: boolean };

export type FileSweepCursorName = 'future_expiration' | 'missing_object' | 'terminal_cleanup';

export type FileSweepCursor = {
  timestamp: Date;
  id: string;
};
