import { drizzle } from 'drizzle-orm/bun-sql';
import { db as dbConfig } from '../config/index';
import * as schema from './schema/index';

/**
 * Lazily-initialised Drizzle client backed by Bun SQL.
 * Import `db` wherever database access is needed.
 * The connection is established on first use — Bun SQL manages the pool.
 * The `schema` object is passed so Drizzle can build type-safe relational queries.
 */
export function createDb() {
  return drizzle(dbConfig.url(), { schema });
}

export type Db = ReturnType<typeof createDb>;
