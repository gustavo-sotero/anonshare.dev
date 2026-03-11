import type { CleanupFileJobPayload } from '@anonshare/contracts';
import { logger } from '@anonshare/infrastructure/logger';
import type { Job } from 'bullmq';

// Placeholder — implemented in Module 5
export async function handleCleanupFile(job: Job<CleanupFileJobPayload>): Promise<void> {
  logger.info('cleanup-file job received', {
    actor: 'worker',
    event: 'cleanup_file_job',
    entity: { type: 'file', id: job.data.fileId },
    outcome: 'success'
  });
  // TODO: delete object from storage and update metadata record
}
