import { sql } from 'drizzle-orm';
import { check, index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

/**
 * GitHub-authenticated admin sessions.
 *
 * `github_id`    — stable numeric GitHub account ID (not the login, which can change).
 *                  Access is denied unless this matches the configured allowlist.
 * `github_login` — GitHub username at session creation time; informational only.
 * `revoked_at`   — set when the session is explicitly signed out or invalidated.
 */
export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    githubId: varchar('github_id', { length: 64 }).notNull(),
    githubLogin: varchar('github_login', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true })
  },
  (t) => [
    check('admin_sessions_github_id_numeric_chk', sql`${t.githubId} ~ '^[0-9]+$'`),
    index('admin_sessions_github_id_idx').on(t.githubId),
    index('admin_sessions_expires_at_idx').on(t.expiresAt)
  ]
);

export type AdminSessionRecord = typeof adminSessions.$inferSelect;
export type NewAdminSessionRecord = typeof adminSessions.$inferInsert;
