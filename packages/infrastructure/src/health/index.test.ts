import { describe, expect, test } from 'bun:test';
import {
  checkDatabaseHealth,
  checkPlatformHealth,
  checkRedisHealth,
  checkStorageHealth,
  evaluatePlatformHealth
} from './index';

function createNowSequence(...values: number[]): () => number {
  let index = 0;

  return () => {
    const value = values[index] ?? values.at(-1) ?? 0;
    index += 1;
    return value;
  };
}

describe('platform health checks', () => {
  test('reports database success with measured duration', async () => {
    const result = await checkDatabaseHealth({
      now: createNowSequence(10, 13.42),
      queryDatabase: async () => {}
    });

    expect(result).toEqual({
      dependency: 'postgres',
      durationMs: 3.42,
      ok: true
    });
  });

  test('captures redis failures as unhealthy results', async () => {
    const result = await checkRedisHealth({
      now: createNowSequence(5, 7),
      pingRedis: async () => {
        throw new Error('connection refused');
      }
    });

    expect(result).toEqual({
      dependency: 'redis',
      details: 'connection refused',
      durationMs: 2,
      ok: false
    });
  });

  test('string failures are normalized for storage health', async () => {
    const result = await checkStorageHealth({
      now: createNowSequence(2, 4.5),
      pingStorage: async () => {
        throw 'bucket missing';
      }
    });

    expect(result).toEqual({
      dependency: 'storage',
      details: 'bucket missing',
      durationMs: 2.5,
      ok: false
    });
  });

  test('aggregates dependency probes for platform health', async () => {
    let databaseCalls = 0;
    let redisCalls = 0;
    let storageCalls = 0;

    const results = await checkPlatformHealth({
      pingRedis: async () => {
        redisCalls += 1;
      },
      pingStorage: async () => {
        storageCalls += 1;
      },
      queryDatabase: async () => {
        databaseCalls += 1;
      }
    });

    expect(databaseCalls).toBe(1);
    expect(redisCalls).toBe(1);
    expect(storageCalls).toBe(1);
    expect(results.map((result) => result.dependency)).toEqual(['postgres', 'redis', 'storage']);
    expect(results.every((result) => result.ok)).toBe(true);
  });

  test('evaluates platform health as degraded when any dependency fails', () => {
    const summary = evaluatePlatformHealth([
      { dependency: 'postgres', durationMs: 1, ok: true },
      { dependency: 'redis', durationMs: 1, ok: false, details: 'timeout' },
      { dependency: 'storage', durationMs: 1, ok: true }
    ]);

    expect(summary).toEqual({
      ok: false,
      results: [
        { dependency: 'postgres', durationMs: 1, ok: true },
        { dependency: 'redis', durationMs: 1, ok: false, details: 'timeout' },
        { dependency: 'storage', durationMs: 1, ok: true }
      ],
      status: 'degraded'
    });
  });
});
