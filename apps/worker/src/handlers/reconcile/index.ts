import { LIFECYCLE_JOB_RETENTION, type ReconcileJobPayload } from '@anonshare/contracts';
import { files } from '@anonshare/infrastructure/db/schema';
import type { Job } from 'bullmq';
import { and, asc, eq, gt, inArray, isNotNull, lt } from 'drizzle-orm';
import { logger } from '../../logger';
import {
  FUTURE_EXPIRATION_BATCH_SIZE,
  FUTURE_EXPIRATION_CURSOR_SETTING_KEY,
  LIFECYCLE_DUPLICATE_SCAN_LIMIT,
  LIFECYCLE_QUEUE_READ_TIMEOUT_MS,
  MISSING_OBJECT_BATCH_SIZE,
  MISSING_OBJECT_CURSOR_SETTING_KEY,
  ORPHANED_OBJECT_BATCH_SIZE,
  PENDING_UPLOAD_STALE_THRESHOLD_MS,
  STALE_EXPIRATION_ANOMALY_THRESHOLD_MS,
  STALE_EXPIRATION_BATCH_SIZE,
  STORAGE_OBJECT_PREFIX,
  STUCK_PENDING_BATCH_SIZE,
  TERMINAL_CLEANUP_BATCH_SIZE,
  TERMINAL_CLEANUP_CURSOR_SETTING_KEY
} from './constants';
import {
  buildFileSweepCursorCondition,
  getAnomalySeverity,
  getDuplicateFileJobs,
  getLifecycleJobSafely,
  getNextFileSweepCursor,
  loadFileSweepCursorSafely,
  loadOrphanScanCursor,
  logStorageCheckFailure,
  parseFileSweepCursor,
  persistFileSweepCursorSafely,
  persistOrphanScanCursor,
  readPersistedFileSweepCursor,
  recordAnomalyIfAbsent,
  recordOrphanedObjectAnomalyIfAbsent,
  recordQueueReadFailure,
  recordScopedAnomalyIfAbsent,
  resolveOlderThan,
  serializeFileSweepCursor,
  shouldDelayConsumedCleanup,
  shouldSkipRepairEnqueue,
  withOptionalCursorCondition,
  withTimeout,
  writePersistedFileSweepCursor
} from './helpers';
import type { ReconcileHandlerDeps } from './types';

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
      )
      .orderBy(asc(files.expiresAt))
      .limit(STALE_EXPIRATION_BATCH_SIZE);

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
          backoff: { type: 'exponential', delay: 1_000 },
          ...LIFECYCLE_JOB_RETENTION
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
        const inserted = await recordAnomalyIfAbsent(
          db,
          'stale_expiration',
          file.id,
          {
            expiresAt: file.expiresAt?.toISOString(),
            overdueMs
          },
          getAnomalySeverity('stale_expiration')
        );
        if (inserted) {
          counters.anomaliesRecorded += 1;
        }
      }
    }

    // ── Pass B: Repair missing future expiration jobs ───────────────────────
    // The upload flow schedules delayed expire jobs, but enqueue failures or
    // queue data loss must not leave future-expiring files without a job.
    const futureExpirationCursorState = await loadFileSweepCursorSafely({
      db,
      cursorName: 'future_expiration',
      getCursor: getFutureExpirationCursor,
      setCursor: setFutureExpirationCursor
    });
    counters.anomaliesRecorded += futureExpirationCursorState.anomaliesRecorded;
    const futureExpirationCursor = futureExpirationCursorState.cursor;
    const futureExpiring = await db
      .select({
        id: files.id,
        expiresAt: files.expiresAt,
        cursorTimestamp: files.expiresAt
      })
      .from(files)
      .where(
        withOptionalCursorCondition(
          and(
            inArray(files.status, ['active', 'expiring']),
            isNotNull(files.expiresAt),
            gt(files.expiresAt, olderThan)
          ) ?? gt(files.expiresAt, olderThan),
          buildFileSweepCursorCondition(files.expiresAt, futureExpirationCursor)
        )
      )
      .orderBy(asc(files.expiresAt), asc(files.id))
      .limit(FUTURE_EXPIRATION_BATCH_SIZE);

    for (const file of futureExpiring) {
      if (!file.expiresAt) continue;

      const delayMs = file.expiresAt.getTime() - Date.now();
      if (delayMs <= 0) continue;

      const jobId = `expire:${file.id}`;
      const existingJobLookup = await getLifecycleJobSafely({
        db,
        queue: expireQueue,
        queueName: 'expire-file',
        fileId: file.id,
        jobId
      });
      if (!existingJobLookup.ok) {
        counters.lifecycleQueueReadFailures += 1;
        if (existingJobLookup.anomalyRecorded) {
          counters.anomaliesRecorded += 1;
        }
        continue;
      }

      const existingJob = existingJobLookup.value;
      if (
        await shouldSkipRepairEnqueue({
          db,
          existingJob,
          queueName: 'expire-file',
          fileId: file.id
        })
      ) {
        continue;
      }

      await expireQueue.add(
        'expire-file',
        { fileId: file.id },
        {
          jobId,
          delay: delayMs,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          ...LIFECYCLE_JOB_RETENTION
        }
      );

      counters.expireJobsRepaired += 1;

      logger.info('Reconcile: repaired missing expire-file job', {
        event: 'reconciliation.anomaly_detected',
        actor: 'worker',
        entity: { type: 'file', id: file.id },
        outcome: 'success',
        anomalyType: 'missing_expire_job',
        resolution: 'expire_job_enqueued',
        expiresAt: file.expiresAt.toISOString()
      });
    }

    counters.anomaliesRecorded += await persistFileSweepCursorSafely({
      db,
      cursorName: 'future_expiration',
      setCursor: setFutureExpirationCursor,
      cursor: getNextFileSweepCursor(futureExpiring, FUTURE_EXPIRATION_BATCH_SIZE)
    });

    // ── Pass C: Handle stuck pending_upload records ─────────────────────────
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
      .orderBy(asc(files.uploadedAt), asc(files.id))
      .limit(STUCK_PENDING_BATCH_SIZE);

    for (const file of stuckPending) {
      let objectExists: boolean;
      try {
        objectExists = await storage.exists(file.objectKey);
      } catch (err) {
        // Storage unavailable for this check — skip; next reconcile will retry.
        counters.storageCheckFailures += 1;
        const inserted = await logStorageCheckFailure({
          db,
          phase: 'stuck_pending',
          entity: { type: 'file', id: file.id },
          operation: 'exists',
          objectKey: file.objectKey,
          err
        });
        if (inserted) {
          counters.anomaliesRecorded += 1;
        }
        continue;
      }

      if (objectExists) {
        const now = new Date();
        const promoteToExpired = Boolean(file.expiresAt && file.expiresAt <= now);

        // Object is safely stored — promote the record to active when still
        // valid, or to expired when the pending record has already expired.
        const [updated] = await db
          .update(files)
          .set({
            status: promoteToExpired ? 'expired' : 'active',
            activatedAt: now
          })
          .where(and(eq(files.id, file.id), eq(files.status, 'pending_upload')))
          .returning({ id: files.id });

        if (!updated) continue; // Race

        counters.pendingUploadsPromoted += 1;

        logger.info('Reconcile: promoted stuck pending_upload', {
          event: 'reconciliation.anomaly_detected',
          actor: 'worker',
          entity: { type: 'file', id: file.id },
          outcome: 'success',
          anomalyType: 'stuck_pending',
          resolution: promoteToExpired ? 'promoted_to_expired' : 'promoted'
        });

        // Re-schedule expiration for promoted active records with future expiry.
        if (!promoteToExpired && file.expiresAt && file.expiresAt > now) {
          const delayMs = file.expiresAt.getTime() - Date.now();
          const jobId = `expire:${file.id}`;
          const existingJobLookup = await getLifecycleJobSafely({
            db,
            queue: expireQueue,
            queueName: 'expire-file',
            fileId: file.id,
            jobId
          });
          if (!existingJobLookup.ok) {
            counters.lifecycleQueueReadFailures += 1;
            if (existingJobLookup.anomalyRecorded) {
              counters.anomaliesRecorded += 1;
            }
            continue;
          }

          const existingJob = existingJobLookup.value;
          if (
            !(await shouldSkipRepairEnqueue({
              db,
              existingJob,
              queueName: 'expire-file',
              fileId: file.id
            }))
          ) {
            await expireQueue.add(
              'expire-file',
              { fileId: file.id },
              {
                jobId,
                delay: delayMs,
                attempts: 3,
                backoff: { type: 'exponential', delay: 5_000 },
                ...LIFECYCLE_JOB_RETENTION
              }
            );
          }
        }

        // If a stale pending record is already expired at promotion time,
        // enqueue cleanup immediately instead of waiting for the next cycle.
        if (promoteToExpired) {
          const cleanupJobId = `cleanup:${file.id}`;
          const existingCleanupJobLookup = await getLifecycleJobSafely({
            db,
            queue: cleanupQueue,
            queueName: 'cleanup-file',
            fileId: file.id,
            jobId: cleanupJobId
          });
          if (!existingCleanupJobLookup.ok) {
            counters.lifecycleQueueReadFailures += 1;
            if (existingCleanupJobLookup.anomalyRecorded) {
              counters.anomaliesRecorded += 1;
            }
            continue;
          }

          const existingCleanupJob = existingCleanupJobLookup.value;
          if (
            !(await shouldSkipRepairEnqueue({
              db,
              existingJob: existingCleanupJob,
              queueName: 'cleanup-file',
              fileId: file.id
            }))
          ) {
            await cleanupQueue.add(
              'cleanup-file',
              { fileId: file.id, objectKey: file.objectKey },
              {
                jobId: cleanupJobId,
                attempts: 5,
                backoff: { type: 'exponential', delay: 1_000 },
                ...LIFECYCLE_JOB_RETENTION
              }
            );
          }
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

    // ── Pass D: Detect active files with missing storage objects ────────────
    // Sample a bounded batch of active/expiring files and persist a cursor so
    // later runs continue from where the previous sweep stopped.
    const missingObjectCursorState = await loadFileSweepCursorSafely({
      db,
      cursorName: 'missing_object',
      getCursor: getMissingObjectCursor,
      setCursor: setMissingObjectCursor
    });
    counters.anomaliesRecorded += missingObjectCursorState.anomaliesRecorded;
    const missingObjectCursor = missingObjectCursorState.cursor;
    const activeBatch = await db
      .select({
        id: files.id,
        objectKey: files.objectKey,
        cursorTimestamp: files.uploadedAt
      })
      .from(files)
      .where(
        withOptionalCursorCondition(
          inArray(files.status, ['active', 'expiring']),
          buildFileSweepCursorCondition(files.uploadedAt, missingObjectCursor)
        )
      )
      .orderBy(asc(files.uploadedAt), asc(files.id))
      .limit(MISSING_OBJECT_BATCH_SIZE);

    for (const file of activeBatch) {
      let objectExists: boolean;
      try {
        objectExists = await storage.exists(file.objectKey);
      } catch (err) {
        counters.storageCheckFailures += 1;
        const inserted = await logStorageCheckFailure({
          db,
          phase: 'missing_object',
          entity: { type: 'file', id: file.id },
          operation: 'exists',
          objectKey: file.objectKey,
          err
        });
        if (inserted) {
          counters.anomaliesRecorded += 1;
        }
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

        const inserted = await recordAnomalyIfAbsent(
          db,
          'missing_object',
          file.id,
          {
            objectKey: file.objectKey
          },
          getAnomalySeverity('missing_object')
        );
        if (inserted) {
          counters.anomaliesRecorded += 1;
        }
      }
    }

    counters.anomaliesRecorded += await persistFileSweepCursorSafely({
      db,
      cursorName: 'missing_object',
      setCursor: setMissingObjectCursor,
      cursor: getNextFileSweepCursor(activeBatch, MISSING_OBJECT_BATCH_SIZE)
    });

    // ── Pass E: Repair missing cleanup jobs for terminal files ──────────────
    // Expired, consumed, and deleted files should not retain their object.
    // If the object still exists and no cleanup job is queued, enqueue one.
    const terminalCleanupCursorState = await loadFileSweepCursorSafely({
      db,
      cursorName: 'terminal_cleanup',
      getCursor: getTerminalCleanupCursor,
      setCursor: setTerminalCleanupCursor
    });
    counters.anomaliesRecorded += terminalCleanupCursorState.anomaliesRecorded;
    const terminalCleanupCursor = terminalCleanupCursorState.cursor;
    const terminalFiles = await db
      .select({
        id: files.id,
        objectKey: files.objectKey,
        status: files.status,
        consumedAt: files.consumedAt,
        cursorTimestamp: files.uploadedAt
      })
      .from(files)
      .where(
        withOptionalCursorCondition(
          inArray(files.status, ['expired', 'consumed', 'deleted']),
          buildFileSweepCursorCondition(files.uploadedAt, terminalCleanupCursor)
        )
      )
      .orderBy(asc(files.uploadedAt), asc(files.id))
      .limit(TERMINAL_CLEANUP_BATCH_SIZE);

    for (const file of terminalFiles) {
      if (shouldDelayConsumedCleanup(file)) {
        continue;
      }

      let objectExists: boolean;
      try {
        objectExists = await storage.exists(file.objectKey);
      } catch (err) {
        counters.storageCheckFailures += 1;
        const inserted = await logStorageCheckFailure({
          db,
          phase: 'terminal_cleanup',
          entity: { type: 'file', id: file.id },
          operation: 'exists',
          objectKey: file.objectKey,
          err
        });
        if (inserted) {
          counters.anomaliesRecorded += 1;
        }
        continue;
      }

      if (!objectExists) continue;

      const cleanupJobId = `cleanup:${file.id}`;
      const existingCleanupJobLookup = await getLifecycleJobSafely({
        db,
        queue: cleanupQueue,
        queueName: 'cleanup-file',
        fileId: file.id,
        jobId: cleanupJobId
      });
      if (!existingCleanupJobLookup.ok) {
        counters.lifecycleQueueReadFailures += 1;
        if (existingCleanupJobLookup.anomalyRecorded) {
          counters.anomaliesRecorded += 1;
        }
        continue;
      }

      const existingCleanupJob = existingCleanupJobLookup.value;
      if (
        await shouldSkipRepairEnqueue({
          db,
          existingJob: existingCleanupJob,
          queueName: 'cleanup-file',
          fileId: file.id
        })
      ) {
        continue;
      }

      await cleanupQueue.add(
        'cleanup-file',
        { fileId: file.id, objectKey: file.objectKey },
        {
          jobId: cleanupJobId,
          attempts: 5,
          backoff: { type: 'exponential', delay: 1_000 },
          ...LIFECYCLE_JOB_RETENTION
        }
      );

      counters.terminalCleanupEnqueued += 1;

      logger.info('Reconcile: repaired missing cleanup job for terminal file', {
        event: 'reconciliation.anomaly_detected',
        actor: 'worker',
        entity: { type: 'file', id: file.id },
        outcome: 'success',
        anomalyType: 'terminal_object_present',
        resolution: 'cleanup_job_enqueued',
        status: file.status,
        objectKey: file.objectKey
      });
    }

    counters.anomaliesRecorded += await persistFileSweepCursorSafely({
      db,
      cursorName: 'terminal_cleanup',
      setCursor: setTerminalCleanupCursor,
      cursor: getNextFileSweepCursor(terminalFiles, TERMINAL_CLEANUP_BATCH_SIZE)
    });

    // ── Pass F: Detect orphaned storage objects without metadata ────────────
    // Orphaned objects are ambiguous and must be surfaced as anomalies rather
    // than auto-deleted. Keep the scan bounded to avoid long reconcile runs.
    let nextOrphanScanCursor: string | null = null;
    let shouldPersistOrphanScanCursor = false;

    try {
      let remainingObjectsToScan = ORPHANED_OBJECT_BATCH_SIZE;
      let startAfter = await getOrphanScanCursor();

      while (remainingObjectsToScan > 0) {
        const listedObjects = await storage.list({
          prefix: STORAGE_OBJECT_PREFIX,
          maxKeys: remainingObjectsToScan,
          ...(startAfter ? { startAfter } : {})
        });

        if (listedObjects.objects.length === 0) {
          nextOrphanScanCursor = null;
          break;
        }

        const knownObjects = await db
          .select({ objectKey: files.objectKey })
          .from(files)
          .where(
            inArray(
              files.objectKey,
              listedObjects.objects.map((object) => object.key)
            )
          );

        const knownKeys = new Set(knownObjects.map((row) => row.objectKey));

        for (const object of listedObjects.objects) {
          if (knownKeys.has(object.key)) continue;

          logger.warn('Reconcile: storage object has no metadata record', {
            event: 'reconciliation.anomaly_detected',
            actor: 'worker',
            entity: { type: 'storage_object', id: object.key },
            outcome: 'failure',
            anomalyType: 'orphaned_object',
            objectKey: object.key,
            sizeBytes: object.size
          });

          const inserted = await recordOrphanedObjectAnomalyIfAbsent(db, object);
          if (inserted) {
            counters.orphanedObjectsDetected += 1;
            counters.anomaliesRecorded += 1;
          }
        }

        remainingObjectsToScan -= listedObjects.objects.length;

        const nextStartAfter = listedObjects.nextStartAfter ?? undefined;

        if (listedObjects.isTruncated && !nextStartAfter) {
          counters.orphanScanFailures += 1;
          nextOrphanScanCursor = null;
          logger.warn('Reconcile: orphan scan truncated without continuation cursor', {
            event: 'reconciliation.anomaly_detected',
            actor: 'worker',
            entity: { type: 'queue', id: 'reconcile' },
            outcome: 'failure',
            anomalyType: 'orphaned_object_scan_incomplete',
            reason: 'missing_next_start_after',
            scannedObjects: ORPHANED_OBJECT_BATCH_SIZE - remainingObjectsToScan,
            listedObjects: listedObjects.objects.length
          });

          const inserted = await recordScopedAnomalyIfAbsent(
            db,
            'reconciliation_scan_incomplete',
            null,
            {
              queue: 'reconcile',
              reason: 'missing_next_start_after',
              scannedObjects: ORPHANED_OBJECT_BATCH_SIZE - remainingObjectsToScan,
              listedObjects: listedObjects.objects.length
            },
            getAnomalySeverity('reconciliation_scan_incomplete'),
            'reconcile:missing_next_start_after'
          );
          if (inserted) {
            counters.anomaliesRecorded += 1;
          }

          break;
        }

        if (!listedObjects.isTruncated) {
          nextOrphanScanCursor = null;
          break;
        }

        nextOrphanScanCursor = nextStartAfter ?? null;
        startAfter = nextStartAfter;
      }

      shouldPersistOrphanScanCursor = true;
    } catch (err) {
      // Storage list failed — leave orphan detection for the next run.
      counters.orphanScanFailures += 1;
      const inserted = await logStorageCheckFailure({
        db,
        phase: 'orphaned_object_scan',
        entity: { type: 'queue', id: 'reconcile' },
        operation: 'list',
        err
      });
      if (inserted) {
        counters.anomaliesRecorded += 1;
      }
    }

    if (shouldPersistOrphanScanCursor) {
      try {
        await setOrphanScanCursor(nextOrphanScanCursor);
      } catch (err) {
        counters.orphanScanFailures += 1;
        logger.warn('Reconcile: failed to persist orphan scan cursor', {
          event: 'reconciliation.anomaly_detected',
          actor: 'worker',
          entity: { type: 'queue', id: 'reconcile' },
          outcome: 'failure',
          anomalyType: 'orphaned_object_scan_cursor_failed',
          reason: 'cursor_write_failed',
          cursor: nextOrphanScanCursor,
          error: err instanceof Error ? err.message : String(err)
        });

        const inserted = await recordScopedAnomalyIfAbsent(
          db,
          'reconciliation_scan_incomplete',
          null,
          {
            queue: 'reconcile',
            reason: 'cursor_write_failed'
          },
          getAnomalySeverity('reconciliation_scan_incomplete'),
          'reconcile:cursor_write_failed'
        );
        if (inserted) {
          counters.anomaliesRecorded += 1;
        }
      }
    }

    // ── Pass G: Detect duplicate pending lifecycle jobs ─────────────────────
    // Dedup jobIds should prevent duplicates. If they still appear (manual
    // requeue or queue corruption), surface them explicitly for operators.
    const pendingStates: Array<
      'waiting' | 'active' | 'delayed' | 'prioritized' | 'waiting-children'
    > = ['waiting', 'active', 'delayed', 'prioritized', 'waiting-children'];

    for (const lifecycleQueue of [
      { name: 'expire-file' as const, queue: expireQueue },
      { name: 'cleanup-file' as const, queue: cleanupQueue }
    ]) {
      let pendingJobs: Array<{ id: unknown; data: { fileId?: string } }>;

      try {
        const queuedJobs = await withTimeout(
          lifecycleQueue.queue.getJobs(pendingStates, 0, LIFECYCLE_DUPLICATE_SCAN_LIMIT - 1),
          lifecycleQueue.name,
          'getJobs',
          LIFECYCLE_QUEUE_READ_TIMEOUT_MS
        );

        pendingJobs = queuedJobs.map((queuedJob) => ({
          id: queuedJob.id,
          data: queuedJob.data
        }));
      } catch (err) {
        counters.lifecycleQueueScanFailures += 1;

        const inserted = await recordQueueReadFailure({
          db,
          queueName: lifecycleQueue.name,
          fileId: null,
          operation: 'getJobs',
          err
        });

        if (inserted) {
          counters.anomaliesRecorded += 1;
        }

        continue;
      }

      const duplicateFileJobs = getDuplicateFileJobs(pendingJobs);

      for (const duplicateGroup of duplicateFileJobs) {
        counters.lifecycleDuplicateJobGroups += 1;
        counters.lifecycleDuplicateJobs += duplicateGroup.jobIds.length;

        logger.warn('Reconcile: duplicate lifecycle jobs detected for same file', {
          event: 'reconciliation.anomaly_detected',
          actor: 'worker',
          entity: { type: 'file', id: duplicateGroup.fileId },
          outcome: 'failure',
          anomalyType: 'lifecycle_job_duplicate',
          queue: lifecycleQueue.name,
          fileId: duplicateGroup.fileId,
          duplicateCount: duplicateGroup.jobIds.length,
          jobIds: duplicateGroup.jobIds
        });

        const inserted = await recordScopedAnomalyIfAbsent(
          db,
          'lifecycle_job_duplicate',
          duplicateGroup.fileId,
          {
            queue: lifecycleQueue.name,
            duplicateCount: duplicateGroup.jobIds.length,
            jobIds: duplicateGroup.jobIds
          },
          getAnomalySeverity('lifecycle_job_duplicate'),
          `${lifecycleQueue.name}:${duplicateGroup.fileId}:duplicate`
        );
        if (inserted) {
          counters.anomaliesRecorded += 1;
        }
      }
    }

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
