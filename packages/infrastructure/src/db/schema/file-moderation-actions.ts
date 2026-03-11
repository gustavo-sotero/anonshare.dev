import { sql } from 'drizzle-orm';
import { check, index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { fileModerationActionEnum, fileStatusEnum } from './enums';
import { files } from './files';

/**
 * Minimal audit trail for destructive or availability-changing admin actions.
 *
 * File records may later be deleted from the primary table, so `file_id` is set
 * to NULL on delete while the historical action entry remains available.
 */
export const fileModerationActions = pgTable(
  'file_moderation_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fileId: uuid('file_id').references(() => files.id, { onDelete: 'set null' }),
    action: fileModerationActionEnum('action').notNull(),
    previousStatus: fileStatusEnum('previous_status').notNull(),
    nextStatus: fileStatusEnum('next_status').notNull(),
    actorGithubId: varchar('actor_github_id', { length: 64 }).notNull(),
    actorGithubLogin: varchar('actor_github_login', { length: 255 }).notNull(),
    reason: varchar('reason', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    check(
      'file_moderation_actions_actor_github_id_numeric_chk',
      sql`${t.actorGithubId} ~ '^[0-9]+$'`
    ),
    check(
      'file_moderation_actions_reason_length_chk',
      sql`${t.reason} IS NULL OR length(${t.reason}) <= 500`
    ),
    index('file_moderation_actions_file_id_idx').on(t.fileId),
    index('file_moderation_actions_action_idx').on(t.action),
    index('file_moderation_actions_created_at_idx').on(t.createdAt),
    index('file_moderation_actions_file_created_at_idx').on(t.fileId, t.createdAt)
  ]
);

export type FileModerationActionRecord = typeof fileModerationActions.$inferSelect;
export type NewFileModerationActionRecord = typeof fileModerationActions.$inferInsert;
