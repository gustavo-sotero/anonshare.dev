import { files } from '@anonshare/infrastructure/db/schema';
import { inArray } from 'drizzle-orm';
import { logger } from '../../logger';
import { ORPHANED_OBJECT_BATCH_SIZE, STORAGE_OBJECT_PREFIX } from './constants';
import {
  getAnomalySeverity,
  logStorageCheckFailure,
  recordOrphanedObjectAnomalyIfAbsent,
  recordScopedAnomalyIfAbsent
} from './helpers';
import type { ReconcileResolvedDeps } from './types';

/**
 * Pass F: Detect orphaned storage objects without metadata.
 *
 * Orphaned objects are ambiguous and must be surfaced as anomalies rather than
 * auto-deleted. The scan is bounded to avoid long reconcile runs and uses a
 * persistent cursor to continue from the last position across runs.
 */
export async function runPassF(ctx: ReconcileResolvedDeps): Promise<{
  orphanedObjectsDetected: number;
  orphanScanFailures: number;
  anomaliesRecorded: number;
}> {
  const { db, storage, getOrphanScanCursor, setOrphanScanCursor } = ctx;
  let orphanedObjectsDetected = 0;
  let orphanScanFailures = 0;
  let anomaliesRecorded = 0;

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
          orphanedObjectsDetected += 1;
          anomaliesRecorded += 1;
        }
      }

      remainingObjectsToScan -= listedObjects.objects.length;

      const nextStartAfter = listedObjects.nextStartAfter ?? undefined;

      if (listedObjects.isTruncated && !nextStartAfter) {
        orphanScanFailures += 1;
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
          anomaliesRecorded += 1;
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
    orphanScanFailures += 1;
    const inserted = await logStorageCheckFailure({
      db,
      phase: 'orphaned_object_scan',
      entity: { type: 'queue', id: 'reconcile' },
      operation: 'list',
      err
    });
    if (inserted) {
      anomaliesRecorded += 1;
    }
  }

  if (shouldPersistOrphanScanCursor) {
    try {
      await setOrphanScanCursor(nextOrphanScanCursor);
    } catch (err) {
      orphanScanFailures += 1;

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
        { queue: 'reconcile', reason: 'cursor_write_failed' },
        getAnomalySeverity('reconciliation_scan_incomplete'),
        'reconcile:cursor_write_failed'
      );
      if (inserted) {
        anomaliesRecorded += 1;
      }
    }
  }

  return { orphanedObjectsDetected, orphanScanFailures, anomaliesRecorded };
}
