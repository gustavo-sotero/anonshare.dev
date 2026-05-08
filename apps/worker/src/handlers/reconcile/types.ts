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
