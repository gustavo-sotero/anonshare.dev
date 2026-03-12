import type {
  CleanupFileJobPayload,
  ExpireFileJobPayload,
  ReconcileJobPayload
} from '@anonshare/contracts';
import type { createDb } from '@anonshare/infrastructure/db';
import { files, operationalAnomalies } from '@anonshare/infrastructure/db/schema';
import { logger } from '@anonshare/infrastructure/logger';
import type { storageAdapter } from '@anonshare/infrastructure/storage';
import type { Job, Queue } from 'bullmq';
import { and, asc, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Only treat a pending_upload as "stuck" once it is older than this threshold.
 * This gives normal uploads enough time to complete under slow connections.
 */
const PENDING_UPLOAD_STALE_THRESHOLD_MS = 10 * 60 * 1_000; // 10 minutes

/**
 * Only record a stale_expiration anomaly when the file is significantly overdue.
 * Files caught in the same reconcile window (e.g., first run after a restart)
 * do not generate noise anomalies.
 */
const STALE_EXPIRATION_ANOMALY_THRESHOLD_MS = 2 * 60 * 60 * 1_000; // 2 hours

/**
 * Max number of active/expiring files checked for missing storage objects per
 * reconcile run. We scan the oldest first; subsequent runs advance the window.
 */
const MISSING_OBJECT_BATCH_SIZE = 50;

/**
 * Max number of stuck pending_upload records resolved per reconcile run.
 */
const STUCK_PENDING_BATCH_SIZE = 100;

// ─── Dep types ────────────────────────────────────────────────────────────────

export type ReconcileHandlerDeps = {
  db: ReturnType<typeof createDb>;
  storage: Pick<typeof storageAdapter, 'exists'>;
  cleanupQueue: Queue<CleanupFileJobPayload>;
  expireQueue: Queue<ExpireFileJobPayload>;
};

// ─── Handler factory ──────────────────────────────────────────────────────────

/**
 * Factory that produces a BullMQ processor function for reconcile jobs.
 *
 * The reconciler is the second layer of lifecycle correctness on top of
 * individual delayed jobs. It detects and corrects divergences between the
 * database, the job queue, and object storage.
 *
 * Three passes per run:
 * A. Fix stale expirations (active files past their expires_at).
 * B. Handle stuck pending_upload records (promote or remove).
 * C. Detect active files whose storage object is missing (mark as missing).
 */
export function makeHandleReconcile(deps: ReconcileHandlerDeps) {
  return async function handleReconcile(job: Job<ReconcileJobPayload>): Promise<void> {
    const olderThan = job.data.olderThan ? new Date(job.data.olderThan) : new Date();
    const { db, storage, cleanupQueue, expireQueue } = deps;

    logger.info('Reconciliation started', {
      event: 'reconciliation.started',
      actor: 'worker',
      entity: { type: 'queue', id: 'reconcile' },
      outcome: 'success',
      olderThan: olderThan.toISOString()
    });

    const counters = {
      staleExpirationsFixed: 0,
      pendingUploadsPromoted: 0,
      pendingUploadsRemoved: 0,
      missingObjectsDetected: 0,
      anomaliesRecorded: 0
    };

    // ── Pass A: Fix stale expirations ─────────────────────────────────────────
    // Finds active/expiring files whose expires_at is in the past but whose
    // status was never updated (e.g., the delayed job was lost or never scheduled).
    const staleExpired = await db
      .select({
        id: files.id,
        objectKey: files.objectKey,
        expiresAt: files.expiresAt
      })
      .from(files)
      .where(
        and(
          inArray(files.status, ['active', 'expiring']),
          isNotNull(files.expiresAt),
          lt(files.expiresAt, olderThan)
        )
      );

    for (const file of staleExpired) {
      // Compare-and-set: only update if still active/expiring.
      const [updated] = await db
        .update(files)
        .set({ status: 'expired' })
        .where(and(eq(files.id, file.id), inArray(files.status, ['active', 'expiring'])))
        .returning({ id: files.id });

      if (!updated) continue; // Race: already updated by another process

      counters.staleExpirationsFixed += 1;

      // Schedule cleanup. The deduplication jobId prevents double-queuing.
      await cleanupQueue.add(
        'cleanup-file',
        { fileId: file.id, objectKey: file.objectKey },
        {
          jobId: `cleanup:${file.id}`,
          attempts: 5,
          backoff: { type: 'exponential', delay: 1_000 }
        }
      );

      logger.info('Reconcile: fixed stale expiration', {
        event: 'reconciliation.anomaly_detected',
        actor: 'worker',
        entity: { type: 'file', id: file.id },
        outcome: 'success',
        anomalyType: 'stale_expiration',
        expiresAt: file.expiresAt?.toISOString()
      });

      // Only record a persistent anomaly for significantly overdue files
      // so the dashboard surfaces actionable issues, not normal catch-up runs.
      const overdueMs = olderThan.getTime() - (file.expiresAt?.getTime() ?? 0);
      if (overdueMs > STALE_EXPIRATION_ANOMALY_THRESHOLD_MS) {
        await recordAnomalyIfAbsent(db, 'stale_expiration', file.id, {
          expiresAt: file.expiresAt?.toISOString(),
          overdueMs
        });
        counters.anomaliesRecorded += 1;
      }
    }

    // ── Pass B: Handle stuck pending_upload records ───────────────────────────
    // Files stuck in pending_upload longer than the stale threshold have either
    // had their upload partially succeed (object exists → promote) or fail
    // outright (object absent → remove the dangling record).
    const staleCutoff = new Date(olderThan.getTime() - PENDING_UPLOAD_STALE_THRESHOLD_MS);

    const stuckPending = await db
      .select({
        id: files.id,
        objectKey: files.objectKey,
        expiresAt: files.expiresAt
      })
      .from(files)
      .where(and(eq(files.status, 'pending_upload'), lt(files.uploadedAt, staleCutoff)))
      .limit(STUCK_PENDING_BATCH_SIZE);

    for (const file of stuckPending) {
      let objectExists: boolean;
      try {
        objectExists = await storage.exists(file.objectKey);
      } catch {
        // Storage unavailable for this check — skip; next reconcile will retry.
        continue;
      }

      if (objectExists) {
        // Object is safely stored — promote the record to active.
        const [updated] = await db
          .update(files)
          .set({ status: 'active', activatedAt: new Date() })
          .where(and(eq(files.id, file.id), eq(files.status, 'pending_upload')))
          .returning({ id: files.id });

        if (!updated) continue; // Race

        counters.pendingUploadsPromoted += 1;

        logger.info('Reconcile: promoted stuck pending_upload to active', {
          event: 'reconciliation.anomaly_detected',
          actor: 'worker',
          entity: { type: 'file', id: file.id },
          outcome: 'success',
          anomalyType: 'stuck_pending',
          resolution: 'promoted'
        });

        // Re-schedule the expiration job if the file has not yet expired.
        if (file.expiresAt && file.expiresAt > new Date()) {
          const delayMs = file.expiresAt.getTime() - Date.now();
          await expireQueue.add(
            'expire-file',
            { fileId: file.id },
            {
              jobId: `expire:${file.id}`,
              delay: delayMs,
              attempts: 3,
              backoff: { type: 'exponential', delay: 5_000 }
            }
          );
        }
      } else {
        // No object in storage — compensate by removing the orphaned record.
        await db
          .delete(files)
          .where(and(eq(files.id, file.id), eq(files.status, 'pending_upload')));

        counters.pendingUploadsRemoved += 1;

        logger.info('Reconcile: removed stuck pending_upload without storage object', {
          event: 'reconciliation.anomaly_detected',
          actor: 'worker',
          entity: { type: 'file', id: file.id },
          outcome: 'success',
          anomalyType: 'stuck_pending',
          resolution: 'removed'
        });
      }
    }

    // ── Pass C: Detect active files with missing storage objects ──────────────
    // Sample the oldest active/expiring files and confirm their objects exist.
    // We process a bounded batch per run to keep reconciliation fast; later
    // runs will advance to newer files automatically.
    const activeBatch = await db
      .select({
        id: files.id,
        objectKey: files.objectKey
      })
      .from(files)
      .where(inArray(files.status, ['active', 'expiring']))
      .orderBy(asc(files.uploadedAt))
      .limit(MISSING_OBJECT_BATCH_SIZE);

    for (const file of activeBatch) {
      let objectExists: boolean;
      try {
        objectExists = await storage.exists(file.objectKey);
      } catch {
        continue;
      }

      if (!objectExists) {
        // Transition to `missing` so the public read layer blocks access,
        // and so the admin dashboard can surface the inconsistency.
        const [updated] = await db
          .update(files)
          .set({ status: 'missing' })
          .where(and(eq(files.id, file.id), inArray(files.status, ['active', 'expiring'])))
          .returning({ id: files.id });

        if (!updated) continue; // Race

        counters.missingObjectsDetected += 1;

        logger.warn('Reconcile: active file has missing storage object', {
          event: 'reconciliation.anomaly_detected',
          actor: 'worker',
          entity: { type: 'file', id: file.id },
          outcome: 'failure',
          anomalyType: 'missing_object',
          objectKey: file.objectKey
        });

        await recordAnomalyIfAbsent(db, 'missing_object', file.id, {
          objectKey: file.objectKey
        });
        counters.anomaliesRecorded += 1;
      }
    }

    logger.info('Reconciliation completed', {
      event: 'reconciliation.completed',
      actor: 'worker',
      entity: { type: 'queue', id: 'reconcile' },
      outcome: 'success',
      ...counters
    });
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Insert an operational anomaly record only if no open (unresolved) anomaly
 * of the same type and file already exists. Prevents anomaly spam across
 * repeated reconcile calls for the same issue.
 */
async function recordAnomalyIfAbsent(
  db: ReturnType<typeof createDb>,
  type: 'stale_expiration' | 'missing_object',
  fileId: string,
  details: Record<string, unknown>
): Promise<void> {
  try {
    const existing = await db.query.operationalAnomalies.findFirst({
      where: and(
        eq(operationalAnomalies.type, type),
        eq(operationalAnomalies.fileId, fileId),
        isNull(operationalAnomalies.resolvedAt)
      )
    });

    if (!existing) {
      await db.insert(operationalAnomalies).values({ type, fileId, details });
    }
  } catch (err) {
    // Best-effort; anomaly recording failure must not abort reconciliation.
    logger.error('Reconcile: failed to record anomaly', {
      event: 'reconciliation.completed',
      actor: 'worker',
      entity: { type: 'file', id: fileId },
      outcome: 'failure',
      anomalyType: type,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}
