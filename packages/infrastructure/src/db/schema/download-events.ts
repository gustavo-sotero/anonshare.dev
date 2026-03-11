import { index, jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { downloadEventTypeEnum } from './enums';
import { files } from './files';

/**
 * Per-file download event trail for analytics and one-time download enforcement.
 *
 * `ip_hash` — truncated/hashed representation of the requester IP for abuse
 *             correlation; never stored as plain text to limit personal-data retention.
 * `context` — unstructured JSON for additional operational details (e.g. user-agent
 *             fragment, failure reason). Not indexed; use for debugging only.
 */
export const downloadEvents = pgTable(
  'download_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    eventType: downloadEventTypeEnum('event_type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    ipHash: varchar('ip_hash', { length: 64 }),
    context: jsonb('context')
  },
  (t) => [
    index('download_events_file_id_idx').on(t.fileId),
    index('download_events_event_type_idx').on(t.eventType),
    index('download_events_file_event_idx').on(t.fileId, t.eventType),
    index('download_events_created_at_idx').on(t.createdAt)
  ]
);

export type DownloadEventRecord = typeof downloadEvents.$inferSelect;
export type NewDownloadEventRecord = typeof downloadEvents.$inferInsert;
