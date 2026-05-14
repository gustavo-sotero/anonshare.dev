import { LIFECYCLE_JOB_RETENTION } from '@anonshare/contracts';
import { files } from '@anonshare/infrastructure/db/schema';
import { and, asc, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import { logger } from '../../logger';
import { STALE_EXPIRATION_ANOMALY_THRESHOLD_MS, STALE_EXPIRATION_BATCH_SIZE } from './constants';
import { getAnomalySeverity, recordAnomalyIfAbsent } from './helpers';
import type { ReconcileResolvedDeps } from './types';

/**
 * Pass A: Fix stale expirations.
 *
 * Finds active/expiring files whose `expires_at` is in the past but whose
 * status was never updated (e.g., the delayed job was lost or never scheduled).
 * Transitions each found file to `expired` and enqueues a cleanup job.
 */
export async function runPassA(
  ctx: ReconcileResolvedDeps
): Promise<{ staleExpirationsFixed: number; anomaliesRecorded: number }> {
  const { db, cleanupQueue, olderThan } = ctx;
  let staleExpirationsFixed = 0;
  let anomaliesRecorded = 0;

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

    staleExpirationsFixed += 1;

    // Schedule cleanup. The deduplication jobId prevents double-queuing.
    await cleanupQueue.add(
      'cleanup-file',
      { fileId: file.id, objectKey: file.objectKey },
      {
        jobId: `cleanup-${file.id}`,
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
        { expiresAt: file.expiresAt?.toISOString(), overdueMs },
        getAnomalySeverity('stale_expiration')
      );
      if (inserted) {
        anomaliesRecorded += 1;
      }
    }
  }

  return { staleExpirationsFixed, anomaliesRecorded };
}
