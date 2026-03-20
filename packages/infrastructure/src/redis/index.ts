import { Redis, type RedisOptions } from 'ioredis';
import { redis as redisCfg } from '../config/index';

export type { Redis };

type RedisProbeClient = Pick<Redis, 'disconnect' | 'ping'>;

function createRedisClient(url: string, options?: RedisOptions): Redis {
  return new Redis(url, options ?? {});
}

let _client: Redis | null = null;

/**
 * Returns a shared Redis client.
 * The connection is established lazily on first call.
 * Used by rate limiting, OAuth pending-state storage, and admin metrics.
 * BullMQ creates its own producer/worker connections through
 * `@anonshare/infrastructure/queue` so queue lifecycle ownership stays explicit.
 */
export function getRedisClient(): Redis {
  if (!_client) {
    _client = createRedisClient(redisCfg.url(), {
      maxRetriesPerRequest: null, // required by BullMQ
      enableReadyCheck: false
    });
  }
  return _client;
}

export async function pingRedisUrl(
  url: string = redisCfg.url(),
  createClient: (url: string, options: RedisOptions) => RedisProbeClient = createRedisClient
): Promise<void> {
  const client = createClient(url, {
    commandTimeout: 2_000,
    connectTimeout: 2_000,
    enableReadyCheck: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => undefined
  });

  try {
    const response = await client.ping();

    if (response !== 'PONG') {
      throw new Error(`Unexpected Redis health check response: ${response}`);
    }
  } finally {
    client.disconnect();
  }
}

export async function closeRedisClient(): Promise<void> {
  if (_client) {
    await _client.quit();
    _client = null;
  }
}
