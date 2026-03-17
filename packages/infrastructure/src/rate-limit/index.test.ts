import { describe, expect, test } from 'bun:test';
import type { Redis } from 'ioredis';
import { checkRateLimit } from './index';

describe('checkRateLimit', () => {
  test('sets expiry on first incremented key and returns Redis TTL', async () => {
    const expireCalls: Array<{ key: string; seconds: number }> = [];

    const redis = {
      incr: async () => 1,
      expire: async (key: string, seconds: number) => {
        expireCalls.push({ key, seconds });
        return 1;
      },
      ttl: async () => 3599
    } as unknown as Redis;

    const result = await checkRateLimit(redis, 'rl:upload:hash', 20, 3600);

    expect(result).toEqual({
      limited: false,
      count: 1,
      limit: 20,
      resetInSeconds: 3599
    });
    expect(expireCalls).toEqual([{ key: 'rl:upload:hash', seconds: 3600 }]);
  });

  test('re-applies expiry when Redis reports key without TTL', async () => {
    const expireCalls: Array<{ key: string; seconds: number }> = [];

    const redis = {
      incr: async () => 7,
      expire: async (key: string, seconds: number) => {
        expireCalls.push({ key, seconds });
        return 1;
      },
      ttl: async () => -1
    } as unknown as Redis;

    const result = await checkRateLimit(redis, 'rl:report:hash', 10, 3600);

    expect(result).toEqual({
      limited: false,
      count: 7,
      limit: 10,
      resetInSeconds: 3600
    });
    expect(expireCalls).toEqual([{ key: 'rl:report:hash', seconds: 3600 }]);
  });

  test('returns limited=true and safe reset window when ttl read races with key expiration', async () => {
    const expireCalls: Array<{ key: string; seconds: number }> = [];

    const redis = {
      incr: async () => 12,
      expire: async (key: string, seconds: number) => {
        expireCalls.push({ key, seconds });
        return 0;
      },
      ttl: async () => -2
    } as unknown as Redis;

    const result = await checkRateLimit(redis, 'rl:share:hash', 11, 60);

    expect(result).toEqual({
      limited: true,
      count: 12,
      limit: 11,
      resetInSeconds: 60
    });
    expect(expireCalls).toEqual([{ key: 'rl:share:hash', seconds: 60 }]);
  });
});
