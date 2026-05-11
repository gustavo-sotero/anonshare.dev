import type { ReconcileJobPayload } from '@anonshare/contracts';
import type { Job } from 'bullmq';
import { logger } from '../../logger';
import {
  FUTURE_EXPIRATION_CURSOR_SETTING_KEY,
  MISSING_OBJECT_CURSOR_SETTING_KEY,
  TERMINAL_CLEANUP_CURSOR_SETTING_KEY
} from './constants';
import {
  loadOrphanScanCursor,
  parseFileSweepCursor,
  persistOrphanScanCursor,
  readPersistedFileSweepCursor,
  resolveOlderThan,
  serializeFileSweepCursor,
  writePersistedFileSweepCursor
} from './helpers';
import { runPassA } from './pass-a';
import { runPassB } from './pass-b';
import { runPassC } from './pass-c';
import { runPassD } from './pass-d';
import { runPassE } from './pass-e';
import { runPassF } from './pass-f';
import { runPassG } from './pass-g';
import type { ReconcileHandlerDeps, ReconcileResolvedDeps } from './types';

export type { ReconcileHandlerDeps } from './types';

/**
 * Factory that produces a BullMQ processor function for reconcile jobs.
 *
 * The reconciler is the second layer of lifecycle correctness on top of
 * individual delayed jobs. It detects and corrects divergences between the
 * database, the job queue, and object storage.
 *
 * Seven passes per run:
 * A. Fix stale expirations (active files past their expires_at).
 * B. Repair missing future expire jobs.
 * C. Handle stuck pending_upload records (promote or remove).
 * D. Detect active files whose storage object is missing (mark as missing).
 * E. Repair missing cleanup jobs for terminal file states.
 * F. Detect orphaned storage objects without metadata.
 * G. Detect duplicate pending lifecycle jobs.
 */
export function makeHandleReconcile(deps: ReconcileHandlerDeps) {
  return async function handleReconcile(job: Job<ReconcileJobPayload>): Promise<void> {
    const startedAtMs = Date.now();
    const olderThan = resolveOlderThan(job.data.olderThan);
    const { db, storage, cleanupQueue, expireQueue } = deps;
    const getFutureExpirationCursor =
      deps.getFutureExpirationCursor ??
      (() =>
        readPersistedFileSweepCursor({
          db,
          settingKey: FUTURE_EXPIRATION_CURSOR_SETTING_KEY
        }).then((cursor) => serializeFileSweepCursor(cursor ?? null) ?? undefined));
    const setFutureExpirationCursor =
      deps.setFutureExpirationCursor ??
      ((cursor: string | null) =>
        writePersistedFileSweepCursor({
          db,
          settingKey: FUTURE_EXPIRATION_CURSOR_SETTING_KEY,
          cursor: parseFileSweepCursor(cursor ?? undefined) ?? null
        }));
    const getMissingObjectCursor =
      deps.getMissingObjectCursor ??
      (() =>
        readPersistedFileSweepCursor({
          db,
          settingKey: MISSING_OBJECT_CURSOR_SETTING_KEY
        }).then((cursor) => serializeFileSweepCursor(cursor ?? null) ?? undefined));
    const setMissingObjectCursor =
      deps.setMissingObjectCursor ??
      ((cursor: string | null) =>
        writePersistedFileSweepCursor({
          db,
          settingKey: MISSING_OBJECT_CURSOR_SETTING_KEY,
          cursor: parseFileSweepCursor(cursor ?? undefined) ?? null
        }));
    const getTerminalCleanupCursor =
      deps.getTerminalCleanupCursor ??
      (() =>
        readPersistedFileSweepCursor({
          db,
          settingKey: TERMINAL_CLEANUP_CURSOR_SETTING_KEY
        }).then((cursor) => serializeFileSweepCursor(cursor ?? null) ?? undefined));
    const setTerminalCleanupCursor =
      deps.setTerminalCleanupCursor ??
      ((cursor: string | null) =>
        writePersistedFileSweepCursor({
          db,
          settingKey: TERMINAL_CLEANUP_CURSOR_SETTING_KEY,
          cursor: parseFileSweepCursor(cursor ?? undefined) ?? null
        }));
    const getOrphanScanCursor = deps.getOrphanScanCursor ?? (() => loadOrphanScanCursor(db));
    const setOrphanScanCursor =
      deps.setOrphanScanCursor ?? ((cursor: string | null) => persistOrphanScanCursor(db, cursor));

    logger.info('Reconciliation started', {
      event: 'reconciliation.started',
      actor: 'worker',
      entity: { type: 'queue', id: 'reconcile' },
      outcome: 'success',
      olderThan: olderThan.toISOString()
    });

    const resolvedDeps: ReconcileResolvedDeps = {
      db,
      storage,
      cleanupQueue,
      expireQueue,
      olderThan,
      getFutureExpirationCursor,
      setFutureExpirationCursor,
      getMissingObjectCursor,
      setMissingObjectCursor,
      getTerminalCleanupCursor,
      setTerminalCleanupCursor,
      getOrphanScanCursor,
      setOrphanScanCursor
    };

    const counters = {
      staleExpirationsFixed: 0,
      expireJobsRepaired: 0,
      pendingUploadsPromoted: 0,
      pendingUploadsRemoved: 0,
      missingObjectsDetected: 0,
      terminalCleanupEnqueued: 0,
      storageCheckFailures: 0,
      orphanScanFailures: 0,
      orphanedObjectsDetected: 0,
      lifecycleDuplicateJobGroups: 0,
      lifecycleDuplicateJobs: 0,
      lifecycleQueueScanFailures: 0,
      lifecycleQueueReadFailures: 0,
      anomaliesRecorded: 0
    };

    const passA = await runPassA(resolvedDeps);
    counters.staleExpirationsFixed += passA.staleExpirationsFixed;
    counters.anomaliesRecorded += passA.anomaliesRecorded;

    const passB = await runPassB(resolvedDeps);
    counters.expireJobsRepaired += passB.expireJobsRepaired;
    counters.lifecycleQueueReadFailures += passB.lifecycleQueueReadFailures;
    counters.anomaliesRecorded += passB.anomaliesRecorded;

    const passC = await runPassC(resolvedDeps);
    counters.pendingUploadsPromoted += passC.pendingUploadsPromoted;
    counters.pendingUploadsRemoved += passC.pendingUploadsRemoved;
    counters.storageCheckFailures += passC.storageCheckFailures;
    counters.lifecycleQueueReadFailures += passC.lifecycleQueueReadFailures;
    counters.anomaliesRecorded += passC.anomaliesRecorded;

    const passD = await runPassD(resolvedDeps);
    counters.missingObjectsDetected += passD.missingObjectsDetected;
    counters.storageCheckFailures += passD.storageCheckFailures;
    counters.anomaliesRecorded += passD.anomaliesRecorded;

    const passE = await runPassE(resolvedDeps);
    counters.terminalCleanupEnqueued += passE.terminalCleanupEnqueued;
    counters.storageCheckFailures += passE.storageCheckFailures;
    counters.lifecycleQueueReadFailures += passE.lifecycleQueueReadFailures;
    counters.anomaliesRecorded += passE.anomaliesRecorded;

    const passF = await runPassF(resolvedDeps);
    counters.orphanedObjectsDetected += passF.orphanedObjectsDetected;
    counters.orphanScanFailures += passF.orphanScanFailures;
    counters.anomaliesRecorded += passF.anomaliesRecorded;

    const passG = await runPassG(resolvedDeps);
    counters.lifecycleDuplicateJobGroups += passG.lifecycleDuplicateJobGroups;
    counters.lifecycleDuplicateJobs += passG.lifecycleDuplicateJobs;
    counters.lifecycleQueueScanFailures += passG.lifecycleQueueScanFailures;
    counters.anomaliesRecorded += passG.anomaliesRecorded;

    logger.info('Reconciliation completed', {
      event: 'reconciliation.completed',
      actor: 'worker',
      entity: { type: 'queue', id: 'reconcile' },
      outcome: 'success',
      durationMs: Date.now() - startedAtMs,
      ...counters
    });
  };
}
