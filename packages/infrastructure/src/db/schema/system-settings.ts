import { pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * Runtime-configurable operational parameters.
 *
 * Keys are application-defined strings (e.g. "report_auto_hide_threshold").
 * Values are stored as text and parsed by each consumer.
 *
 * Seeded with default thresholds at bootstrap — see scripts/seed.ts.
 */
export const systemSettings = pgTable('system_settings', {
  key: varchar('key', { length: 255 }).primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export type SystemSettingRecord = typeof systemSettings.$inferSelect;
export type NewSystemSettingRecord = typeof systemSettings.$inferInsert;
