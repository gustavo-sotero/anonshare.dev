import { Redis } from 'ioredis';
import { redis as redisCfg } from '../config/index';

export type { Redis };

let _client: Redis | null = null;

/**
 * Returns a shared Redis client.
 * The connection is established lazily on first call.
 * Used by BullMQ, rate-limiter and cache helpers.
 */
export function getRedisClient(): Redis {
  if (!_client) {
    _client = new Redis(redisCfg.url(), {
      maxRetriesPerRequest: null, // required by BullMQ
      enableReadyCheck: false
    });
  }
  return _client;
}

export async function closeRedisClient(): Promise<void> {
  if (_client) {
    await _client.quit();
    _client = null;
  }
}
