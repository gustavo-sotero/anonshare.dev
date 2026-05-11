import { files } from '@anonshare/infrastructure/db/schema';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { logger } from '../../logger';
import { MISSING_OBJECT_BATCH_SIZE } from './constants';
import {
  buildFileSweepCursorCondition,
  getAnomalySeverity,
  getNextFileSweepCursor,
  loadFileSweepCursorSafely,
  logStorageCheckFailure,
  persistFileSweepCursorSafely,
  recordAnomalyIfAbsent,
  withOptionalCursorCondition
} from './helpers';
import type { ReconcileResolvedDeps } from './types';

/**
 * Pass D: Detect active files with missing storage objects.
 *
 * Samples a bounded batch of active/expiring files and persists a cursor so
 * later runs continue from where the previous sweep stopped. Files whose
 * storage objects are absent are transitioned to `missing` so the public read
 * layer blocks access and the admin dashboard can surface the inconsistency.
 */
export async function runPassD(ctx: ReconcileResolvedDeps): Promise<{
  missingObjectsDetected: number;
  storageCheckFailures: number;
  anomaliesRecorded: number;
}> {
  const { db, storage, getMissingObjectCursor, setMissingObjectCursor } = ctx;
  let missingObjectsDetected = 0;
  let storageCheckFailures = 0;
  let anomaliesRecorded = 0;

  const missingObjectCursorState = await loadFileSweepCursorSafely({
    db,
    cursorName: 'missing_object',
    getCursor: getMissingObjectCursor,
    setCursor: setMissingObjectCursor
  });
  anomaliesRecorded += missingObjectCursorState.anomaliesRecorded;
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
      storageCheckFailures += 1;
      const inserted = await logStorageCheckFailure({
        db,
        phase: 'missing_object',
        entity: { type: 'file', id: file.id },
        operation: 'exists',
        objectKey: file.objectKey,
        err
      });
      if (inserted) {
        anomaliesRecorded += 1;
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

      missingObjectsDetected += 1;

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
        { objectKey: file.objectKey },
        getAnomalySeverity('missing_object')
      );
      if (inserted) {
        anomaliesRecorded += 1;
      }
    }
  }

  anomaliesRecorded += await persistFileSweepCursorSafely({
    db,
    cursorName: 'missing_object',
    setCursor: setMissingObjectCursor,
    cursor: getNextFileSweepCursor(activeBatch, MISSING_OBJECT_BATCH_SIZE)
  });

  return { missingObjectsDetected, storageCheckFailures, anomaliesRecorded };
}
