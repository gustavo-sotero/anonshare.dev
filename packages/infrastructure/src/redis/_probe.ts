import { Redis, type RedisOptions } from 'ioredis';
export function n(url: string, options?: RedisOptions): Redis {
  return new (Redis as new (url: string, options?: RedisOptions) => Redis)(url, options);
}