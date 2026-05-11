import { logger } from '../../logger';
import { LIFECYCLE_DUPLICATE_SCAN_LIMIT, LIFECYCLE_QUEUE_READ_TIMEOUT_MS } from './constants';
import {
  getAnomalySeverity,
  getDuplicateFileJobs,
  recordQueueReadFailure,
  recordScopedAnomalyIfAbsent,
  withTimeout
} from './helpers';
import type { ReconcileResolvedDeps } from './types';

/**
 * Pass G: Detect duplicate pending lifecycle jobs.
 *
 * Dedup jobIds should prevent duplicates. If they still appear (manual requeue
 * or queue corruption), surface them explicitly for operators. This pass only
 * detects and records anomalies; it does not remove jobs.
 */
export async function runPassG(ctx: ReconcileResolvedDeps): Promise<{
  lifecycleDuplicateJobGroups: number;
  lifecycleDuplicateJobs: number;
  lifecycleQueueScanFailures: number;
  anomaliesRecorded: number;
}> {
  const { db, expireQueue, cleanupQueue } = ctx;
  let lifecycleDuplicateJobGroups = 0;
  let lifecycleDuplicateJobs = 0;
  let lifecycleQueueScanFailures = 0;
  let anomaliesRecorded = 0;

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
      lifecycleQueueScanFailures += 1;

      const inserted = await recordQueueReadFailure({
        db,
        queueName: lifecycleQueue.name,
        fileId: null,
        operation: 'getJobs',
        err
      });

      if (inserted) {
        anomaliesRecorded += 1;
      }

      continue;
    }

    const duplicateFileJobs = getDuplicateFileJobs(pendingJobs);

    for (const duplicateGroup of duplicateFileJobs) {
      lifecycleDuplicateJobGroups += 1;
      lifecycleDuplicateJobs += duplicateGroup.jobIds.length;

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
        anomaliesRecorded += 1;
      }
    }
  }

  return {
    lifecycleDuplicateJobGroups,
    lifecycleDuplicateJobs,
    lifecycleQueueScanFailures,
    anomaliesRecorded
  };
}
