import type { ExpireFileJobPayload } from '@anonshare/contracts';
import { logger } from '@anonshare/infrastructure/logger';
import type { Job } from 'bullmq';

// Placeholder — implemented in Module 5
export async function handleExpireFile(job: Job<ExpireFileJobPayload>): Promise<void> {
  logger.info('expire-file job received', {
    actor: 'worker',
    event: 'expire_file_job',
    entity: { type: 'file', id: job.data.fileId },
    outcome: 'success'
  });
  // TODO: mark file as expired and schedule cleanup
}
