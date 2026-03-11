import { createConnection } from 'node:net';
import { SQL } from 'bun';
import { db, redis } from '../config/index';
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
  const parsed = new URL(redis.url());
  const host = parsed.hostname;
  const port = Number(parsed.port || '6379');

  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host, port });
    let settled = false;
    let response = '';

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      callback();
    };

    socket.setTimeout(2_000);

    socket.on('connect', () => {
      socket.write('*1\r\n$4\r\nPING\r\n');
    });

    socket.on('data', (chunk) => {
      response += chunk.toString();

      if (response.startsWith('+PONG')) {
        finish(resolve);
        return;
      }

      if (response.startsWith('-')) {
        finish(() => reject(new Error(response.trim())));
      }
    });

    socket.on('timeout', () => {
      finish(() => reject(new Error('Redis health check timed out')));
    });

    socket.on('error', (error) => {
      finish(() => reject(error));
    });

    socket.on('close', () => {
      if (!settled) {
        finish(() => reject(new Error('Redis connection closed before PONG')));
      }
    });
  });
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
