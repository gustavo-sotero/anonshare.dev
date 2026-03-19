import { SQL } from 'bun';
import { db, redis } from '../config/index';
import { pingRedisUrl } from '../redis/index';
import { storageAdapter } from '../storage/index';

export type DependencyHealthName = 'postgres' | 'redis' | 'storage';

export type DependencyHealthResult = {
  dependency: DependencyHealthName;
  durationMs: number;
  ok: boolean;
  details?: string;
};

export type PlatformHealthStatus = 'ok' | 'degraded';

export type PlatformHealthSummary = {
  ok: boolean;
  results: DependencyHealthResult[];
  status: PlatformHealthStatus;
};

type HealthCheckOverrides = {
  now?: () => number;
  pingRedis?: () => Promise<void>;
  pingStorage?: () => Promise<void>;
  queryDatabase?: () => Promise<void>;
};

async function measureHealth(
  dependency: DependencyHealthName,
  fn: () => Promise<void>,
  now: () => number = () => performance.now()
): Promise<DependencyHealthResult> {
  const startedAt = now();

  try {
    await fn();

    return {
      dependency,
      durationMs: Number((now() - startedAt).toFixed(2)),
      ok: true
    };
  } catch (error) {
    return {
      dependency,
      durationMs: Number((now() - startedAt).toFixed(2)),
      ok: false,
      details: error instanceof Error ? error.message : String(error)
    };
  }
}

async function runDatabaseQuery(): Promise<void> {
  const sql = new SQL({ connectionTimeout: 2, url: db.url() });

  try {
    await sql`select 1 as ok`;
  } finally {
    await sql.close({ timeout: 0 });
  }
}

async function pingRedisConnection(): Promise<void> {
  await pingRedisUrl(redis.url());
}

async function pingStorageConnection(): Promise<void> {
  await storageAdapter.checkAccess();
}

export async function checkDatabaseHealth(
  overrides: Pick<HealthCheckOverrides, 'now' | 'queryDatabase'> = {}
): Promise<DependencyHealthResult> {
  return measureHealth('postgres', overrides.queryDatabase ?? runDatabaseQuery, overrides.now);
}

export async function checkRedisHealth(
  overrides: Pick<HealthCheckOverrides, 'now' | 'pingRedis'> = {}
): Promise<DependencyHealthResult> {
  return measureHealth('redis', overrides.pingRedis ?? pingRedisConnection, overrides.now);
}

export async function checkStorageHealth(
  overrides: Pick<HealthCheckOverrides, 'now' | 'pingStorage'> = {}
): Promise<DependencyHealthResult> {
  return measureHealth('storage', overrides.pingStorage ?? pingStorageConnection, overrides.now);
}

export async function checkPlatformHealth(
  overrides: HealthCheckOverrides = {}
): Promise<DependencyHealthResult[]> {
  return Promise.all([
    checkDatabaseHealth(overrides),
    checkRedisHealth(overrides),
    checkStorageHealth(overrides)
  ]);
}

export function evaluatePlatformHealth(results: DependencyHealthResult[]): PlatformHealthSummary {
  const ok = results.every((result) => result.ok);

  return {
    ok,
    results,
    status: ok ? 'ok' : 'degraded'
  };
}
