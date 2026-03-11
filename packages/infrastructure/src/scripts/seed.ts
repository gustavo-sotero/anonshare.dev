/**
 * Seed script for default operational settings.
 *
 * Safe to run multiple times — uses INSERT ... ON CONFLICT DO UPDATE to be
 * idempotent so the same command works for both fresh and existing databases.
 *
 * Usage:
 *   bun --env-file=../../.env src/scripts/seed.ts
 */

import { sql } from 'drizzle-orm';
import { deriveLocalPlatformEnv, SYSTEM_SETTING_DEFAULTS } from '../config/index';
import type { Db } from '../db/client';
import { createDb } from '../db/client';
import { systemSettings } from '../db/schema/index';
import { logger } from '../logger/index';

export async function seedDatabase(db: Db): Promise<void> {
  logger.info('Starting database seed', { event: 'seed_start', actor: 'worker' });

  for (const setting of SYSTEM_SETTING_DEFAULTS) {
    await db
      .insert(systemSettings)
      .values({ key: setting.key, value: setting.value })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: sql`excluded.value`, updatedAt: sql`now()` }
      });

    logger.info(`Seeded setting: ${setting.key} = ${setting.value}`, {
      event: 'seed_setting',
      actor: 'worker'
    });
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
