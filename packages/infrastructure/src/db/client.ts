import { drizzle } from 'drizzle-orm/bun-sql';
import { db as dbConfig } from '../config/index';

/**
 * Lazily-initialised Drizzle client backed by Bun SQL.
 * Import `db` wherever database access is needed.
 * The connection is established on first use — Bun SQL manages the pool.
 */
export function createDb() {
  return drizzle(dbConfig.url());
}

export type Db = ReturnType<typeof createDb>;
