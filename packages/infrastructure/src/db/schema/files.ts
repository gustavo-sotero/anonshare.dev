import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from 'drizzle-orm/pg-core';
import { fileStatusEnum } from './enums';

/**
 * Central file metadata table.
 *
 * `token`      — unguessable public share identifier (URL path segment).
 * `object_key` — internal S3-compatible object key; never exposed to clients.
 * `status`     — lifecycle state machine; see packages/domain/src/file-status.ts.
 */
export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    token: varchar('token', { length: 64 }).notNull(),
    objectKey: varchar('object_key', { length: 512 }).notNull(),
    originalFilename: varchar('original_filename', { length: 512 }).notNull(),
    sanitizedFilename: varchar('sanitized_filename', { length: 512 }).notNull(),
    mimeType: varchar('mime_type', { length: 255 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    status: fileStatusEnum('status').notNull().default('pending_upload'),
    allowPreview: boolean('allow_preview').notNull().default(false),
    oneTimeDownload: boolean('one_time_download').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    reportCount: integer('report_count').notNull().default(0)
  },
  (t) => [
    check('files_token_format_chk', sql`${t.token} ~ '^[A-Za-z0-9_-]{16,64}$'`),
    check('files_preview_one_time_chk', sql`NOT (${t.oneTimeDownload} AND ${t.allowPreview})`),
    check('files_size_bytes_positive_chk', sql`${t.sizeBytes} > 0`),
    check('files_report_count_nonnegative_chk', sql`${t.reportCount} >= 0`),
    check(
      'files_expires_at_window_chk',
      sql`${t.expiresAt} IS NULL OR (${t.expiresAt} >= ${t.uploadedAt} AND ${t.expiresAt} <= ${t.uploadedAt} + interval '30 days')`
    ),
    uniqueIndex('files_token_uidx').on(t.token),
    uniqueIndex('files_object_key_uidx').on(t.objectKey),
    index('files_status_idx').on(t.status),
    index('files_status_uploaded_at_idx').on(t.status, t.uploadedAt),
    index('files_expires_at_idx').on(t.expiresAt),
    index('files_uploaded_at_idx').on(t.uploadedAt),
    index('files_report_count_idx').on(t.reportCount)
  ]
);

export type FileRecord = typeof files.$inferSelect;
export type NewFileRecord = typeof files.$inferInsert;
