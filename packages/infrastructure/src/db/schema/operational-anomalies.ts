import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { operationalAnomalyTypeEnum } from './enums';
import { files } from './files';

/**
 * Operational inconsistencies detected by the reconciliation job.
 *
 * Known `type` values:
 *   - "missing_object"    — metadata active but no object found in storage
 *   - "orphaned_object"   — object in storage with no matching metadata
 *   - "stale_expiration"  — file past expires_at but status not yet updated
 *   - "failed_cleanup"    — cleanup job could not delete object after max retries
 *
 * `file_id` is nullable: orphaned-object anomalies may have no metadata record.
 * Set to NULL on file deletion so anomaly records survive for admin review.
 */
export const operationalAnomalies = pgTable(
  'operational_anomalies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: operationalAnomalyTypeEnum('type').notNull(),
    fileId: uuid('file_id').references(() => files.id, { onDelete: 'set null' }),
    details: jsonb('details'),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolution: text('resolution')
  },
  (t) => [
    index('operational_anomalies_type_idx').on(t.type),
    index('operational_anomalies_file_id_idx').on(t.fileId),
    index('operational_anomalies_detected_at_idx').on(t.detectedAt),
    index('operational_anomalies_resolved_at_idx').on(t.resolvedAt)
  ]
);

export type OperationalAnomalyRecord = typeof operationalAnomalies.$inferSelect;
export type NewOperationalAnomalyRecord = typeof operationalAnomalies.$inferInsert;
