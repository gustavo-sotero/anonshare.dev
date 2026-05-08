/**
 * One-shot script: backfill a 30-day expiration deadline for any active or
 * expiring files that were created before the expiresAt column was made
 * non-nullable. Files whose computed deadline has already passed are
 * immediately marked as expired.
 *
 * This logic was previously embedded in the steady-state reconciliation
 * handler (Pass H). It was extracted here so the reconcile loop no longer
 * pays a DB query cost on every run once legacy data is gone.
 *
 * Safe to run multiple times — the WHERE clause pins on `expiresAt IS NULL` so
 * already-repaired rows are naturally excluded.
 *
 * Usage:
 *   bun --env-file=../../.env src/scripts/repair-null-expiration.ts
 */

import { MAX_EXPIRATION_DAYS } from '@anonshare/domain';
import { and, asc, inArray, isNull } from 'drizzle-orm';
import { deriveLocalPlatformEnv } from '../config/index';
import { createDb } from '../db/client';
import { files } from '../db/schema/index';
import { logger } from '../logger/index';

const BATCH_SIZE = 100;
const MAX_FILE_LIFETIME_MS = MAX_EXPIRATION_DAYS * 24 * 60 * 60 * 1_000;

function getDefaultExpirationForUpload(uploadedAt: Date | undefined): Date {
  const baseTime = uploadedAt?.getTime() ?? Date.now();
  return new Date(baseTime + MAX_FILE_LIFETIME_MS);
}

async function repairNullExpiration(): Promise<void> {
  const db = createDb();
  const now = new Date();
  let totalRepaired = 0;
  let totalExpired = 0;

  logger.info('Starting null-expiration repair', {
    event: 'repair_null_expiration.start',
    actor: 'script'
  });

  while (true) {
    const batch = await db
      .select({
        id: files.id,
        objectKey: files.objectKey,
        uploadedAt: files.uploadedAt
      })
      .from(files)
      .where(and(inArray(files.status, ['active', 'expiring']), isNull(files.expiresAt)))
      .orderBy(asc(files.uploadedAt), asc(files.id))
      .limit(BATCH_SIZE);

    if (batch.length === 0) {
      break;
    }

    for (const file of batch) {
      const repairedExpiresAt = getDefaultExpirationForUpload(file.uploadedAt ?? undefined);
      const isOverdue = repairedExpiresAt <= now;

      const [updated] = await db
        .update(files)
        .set({
          expiresAt: repairedExpiresAt,
          ...(isOverdue ? { status: 'expired' as const } : {})
        })
        .where(and(and(inArray(files.status, ['active', 'expiring']), isNull(files.expiresAt))))
        .returning({ id: files.id });

      if (!updated) {
        continue;
      }

      if (isOverdue) {
        totalExpired += 1;
        logger.info('Repaired: backfilled overdue expiration (marked expired)', {
          event: 'repair_null_expiration.expired',
          actor: 'script',
          entity: { type: 'file', id: file.id },
          expiresAt: repairedExpiresAt.toISOString()
        });
      } else {
        totalRepaired += 1;
        logger.info('Repaired: backfilled future expiration deadline', {
          event: 'repair_null_expiration.backfilled',
          actor: 'script',
          entity: { type: 'file', id: file.id },
          expiresAt: repairedExpiresAt.toISOString()
        });
      }
    }

    if (batch.length < BATCH_SIZE) {
      break;
    }
  }

  logger.info('Null-expiration repair complete', {
    event: 'repair_null_expiration.complete',
    actor: 'script',
    outcome: 'success',
    totalRepaired,
    totalExpired
  });
}

if (import.meta.main) {
  deriveLocalPlatformEnv();
  repairNullExpiration().catch((err: unknown) => {
    logger.error('Null-expiration repair failed', {
      event: 'repair_null_expiration.failed',
      actor: 'script',
      outcome: 'failure',
      err
    });
    process.exit(1);
  });
}
