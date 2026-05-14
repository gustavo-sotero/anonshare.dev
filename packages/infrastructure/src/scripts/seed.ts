/**
 * Seed script for default operational settings.
 *
 * Safe to run multiple times — uses INSERT ... ON CONFLICT DO NOTHING so existing
 * rows (including operator-customized values) are never overwritten. Only rows
 * that do not yet exist are inserted with their code-defined defaults.
 *
 * Usage:
 *   bun --env-file=../../.env src/scripts/seed.ts
 */

import { deriveLocalPlatformEnv, SYSTEM_SETTING_DEFAULTS } from '../config/index';
import type { Db } from '../db/client';
import { createDb } from '../db/client';
import { systemSettings } from '../db/schema/index';
import { logger } from '../logger/index';

export async function seedDatabase(db: Db): Promise<void> {
  logger.info('Starting database seed', { event: 'seed_start', actor: 'worker' });

  for (const setting of SYSTEM_SETTING_DEFAULTS) {
    const result = await db
      .insert(systemSettings)
      .values({ key: setting.key, value: setting.value })
      .onConflictDoNothing({ target: systemSettings.key })
      .returning({ key: systemSettings.key });

    const inserted = result.length > 0;
    logger.info(
      `Setting: ${setting.key} — ${inserted ? `inserted default (${setting.value})` : 'already exists, skipped'}`,
      {
        event: 'seed_setting',
        actor: 'worker',
        key: setting.key,
        inserted
      }
    );
  }

  logger.info('Database seed complete', {
    event: 'seed_complete',
    actor: 'worker',
    outcome: 'success'
  });
}

async function main(): Promise<void> {
  deriveLocalPlatformEnv();
  await seedDatabase(createDb());
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    logger.error('Seed failed', {
      event: 'seed_failed',
      actor: 'worker',
      outcome: 'failure',
      err
    });
    process.exit(1);
  });
}
