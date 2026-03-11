import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { reportReasonEnum, reportStatusEnum } from './enums';
import { files } from './files';

/**
 * Abuse/moderation reports submitted from public file pages.
 *
 * `resolved_by` — GitHub login of the admin who took action; null while pending.
 * `ip_hash`     — hashed requester IP for rate-limit and spam deduplication.
 *                 Never stored as plain text.
 */
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    reason: reportReasonEnum('reason').notNull(),
    message: text('message'),
    status: reportStatusEnum('status').notNull().default('pending'),
    resolvedBy: varchar('resolved_by', { length: 255 }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    ipHash: varchar('ip_hash', { length: 64 })
  },
  (t) => [
    check('reports_message_length_chk', sql`${t.message} IS NULL OR length(${t.message}) <= 1000`),
    check(
      'reports_resolution_consistency_chk',
      sql`(
        ${t.status} = 'pending' AND ${t.resolvedBy} IS NULL AND ${t.resolvedAt} IS NULL
      ) OR (
        ${t.status} IN ('resolved', 'dismissed') AND ${t.resolvedBy} IS NOT NULL AND ${t.resolvedAt} IS NOT NULL
      )`
    ),
    index('reports_file_id_idx').on(t.fileId),
    index('reports_status_idx').on(t.status),
    index('reports_file_status_idx').on(t.fileId, t.status),
    index('reports_created_at_idx').on(t.createdAt)
  ]
);

export type ReportRecord = typeof reports.$inferSelect;
export type NewReportRecord = typeof reports.$inferInsert;
