import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { deriveLocalPlatformEnv, validateApiEnv, validateWebEnv, validateWorkerEnv } from './index';

const originalEnv = { ...process.env };

function resetEnv(): void {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(originalEnv)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
}

beforeEach(() => {
  resetEnv();
});

afterEach(() => {
  resetEnv();
});

describe('environment validation', () => {
  test('deriveLocalPlatformEnv populates local tooling defaults from compose variables', () => {
    const env: Record<string, string | undefined> = {
      MINIO_API_PORT: '9100',
      MINIO_BUCKET: 'platform-bucket',
      MINIO_ROOT_PASSWORD: 'storage-password',
      MINIO_ROOT_USER: 'storage-user',
      POSTGRES_DB: 'platform-db',
      POSTGRES_PASSWORD: 'platform-password',
      POSTGRES_PORT: '6543',
      POSTGRES_USER: 'platform-user',
      REDIS_PORT: '6380'
    };

    deriveLocalPlatformEnv(env);

    expect(env.DATABASE_URL).toBe(
      'postgresql://platform-user:platform-password@127.0.0.1:6543/platform-db'
    );
    expect(env.REDIS_URL).toBe('redis://127.0.0.1:6380');
    expect(env.STORAGE_ENDPOINT).toBe('http://127.0.0.1:9100');
    expect(env.STORAGE_ACCESS_KEY_ID).toBe('storage-user');
    expect(env.STORAGE_SECRET_ACCESS_KEY).toBe('storage-password');
    expect(env.STORAGE_BUCKET).toBe('platform-bucket');
    expect(env.STORAGE_REGION).toBe('us-east-1');
  });

  test('deriveLocalPlatformEnv preserves explicit runtime URLs', () => {
    const env: Record<string, string | undefined> = {
      DATABASE_URL: 'postgresql://explicit-user:explicit-pass@db:5432/explicit-db',
      REDIS_URL: 'redis://redis:6379',
      STORAGE_ACCESS_KEY_ID: 'explicit-key',
      STORAGE_BUCKET: 'explicit-bucket',
      STORAGE_ENDPOINT: 'https://storage.example.com',
      STORAGE_REGION: 'sa-east-1',
      STORAGE_SECRET_ACCESS_KEY: 'explicit-secret'
    };

    deriveLocalPlatformEnv(env);

    expect(env.DATABASE_URL).toBe('postgresql://explicit-user:explicit-pass@db:5432/explicit-db');
    expect(env.REDIS_URL).toBe('redis://redis:6379');
    expect(env.STORAGE_ENDPOINT).toBe('https://storage.example.com');
    expect(env.STORAGE_ACCESS_KEY_ID).toBe('explicit-key');
    expect(env.STORAGE_SECRET_ACCESS_KEY).toBe('explicit-secret');
    expect(env.STORAGE_BUCKET).toBe('explicit-bucket');
    expect(env.STORAGE_REGION).toBe('sa-east-1');
  });

  test('validateWebEnv requires explicit public endpoints', () => {
    delete process.env.APP_BASE_URL;
    delete process.env.APP_API_URL;

    expect(() => validateWebEnv()).toThrow('APP_API_URL');
  });

  test('validateApiEnv returns the required validated shape', () => {
    process.env.NODE_ENV = 'development';
    process.env.APP_BASE_URL = 'http://localhost:3000';
    process.env.DATABASE_URL = 'postgresql://anonshare:anonshare@localhost:5432/anonshare';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.STORAGE_ENDPOINT = 'http://localhost:9000';
    process.env.STORAGE_ACCESS_KEY_ID = 'minioadmin';
    process.env.STORAGE_SECRET_ACCESS_KEY = 'minioadmin';
    process.env.STORAGE_BUCKET = 'anonshare';
    process.env.GITHUB_CLIENT_ID = 'github-client-id';
    process.env.GITHUB_CLIENT_SECRET = 'github-client-secret';
    process.env.GITHUB_ALLOWED_USER_ID = '123456';
    process.env.SESSION_SECRET = 'session-secret-that-is-at-least-32-chars!';
    process.env.PORT = '3001';

    expect(validateApiEnv()).toEqual({
      appBaseUrl: 'http://localhost:3000',
      appEnv: 'development',
      databaseUrl: 'postgresql://anonshare:anonshare@localhost:5432/anonshare',
      githubAllowedUserId: '123456',
      githubClientId: 'github-client-id',
      githubClientSecret: 'github-client-secret',
      port: 3001,
      redisUrl: 'redis://localhost:6379',
      sessionSecret: 'session-secret-that-is-at-least-32-chars!',
      storageAccessKeyId: 'minioadmin',
      storageBucket: 'anonshare',
      storageEndpoint: 'http://localhost:9000',
      storageRegion: 'us-east-1',
      storageSecretAccessKey: 'minioadmin'
    });
  });

  test('validateApiEnv rejects malformed URLs and ports', () => {
    process.env.NODE_ENV = 'development';
    process.env.APP_BASE_URL = 'not-a-url';
    process.env.DATABASE_URL = 'postgresql://anonshare:anonshare@localhost:5432/anonshare';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.STORAGE_ENDPOINT = 'http://localhost:9000';
    process.env.STORAGE_ACCESS_KEY_ID = 'minioadmin';
    process.env.STORAGE_SECRET_ACCESS_KEY = 'minioadmin';
    process.env.STORAGE_BUCKET = 'anonshare';
    process.env.GITHUB_CLIENT_ID = 'github-client-id';
    process.env.GITHUB_CLIENT_SECRET = 'github-client-secret';
    process.env.GITHUB_ALLOWED_USER_ID = '123456';
    process.env.SESSION_SECRET = 'session-secret-that-is-at-least-32-chars!';
    process.env.PORT = 'abc';

    expect(() => validateApiEnv()).toThrow('APP_BASE_URL');

    process.env.APP_BASE_URL = 'http://localhost:3000';

    expect(() => validateApiEnv()).toThrow('PORT');
  });

  test('validateApiEnv rejects non-numeric GITHUB_ALLOWED_USER_ID', () => {
    process.env.NODE_ENV = 'development';
    process.env.APP_BASE_URL = 'http://localhost:3000';
    process.env.DATABASE_URL = 'postgresql://anonshare:anonshare@localhost:5432/anonshare';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.STORAGE_ENDPOINT = 'http://localhost:9000';
    process.env.STORAGE_ACCESS_KEY_ID = 'minioadmin';
    process.env.STORAGE_SECRET_ACCESS_KEY = 'minioadmin';
    process.env.STORAGE_BUCKET = 'anonshare';
    process.env.GITHUB_CLIENT_ID = 'github-client-id';
    process.env.GITHUB_CLIENT_SECRET = 'github-client-secret';
    process.env.SESSION_SECRET = 'session-secret-that-is-at-least-32-chars!';

    process.env.GITHUB_ALLOWED_USER_ID = 'not-a-number';
    expect(() => validateApiEnv()).toThrow('GITHUB_ALLOWED_USER_ID');

    process.env.GITHUB_ALLOWED_USER_ID = '123abc';
    expect(() => validateApiEnv()).toThrow('GITHUB_ALLOWED_USER_ID');

    process.env.GITHUB_ALLOWED_USER_ID = '99999999';
    expect(() => validateApiEnv()).not.toThrow();
  });

  test('validateApiEnv rejects SESSION_SECRET shorter than 32 characters', () => {
    process.env.NODE_ENV = 'development';
    process.env.APP_BASE_URL = 'http://localhost:3000';
    process.env.DATABASE_URL = 'postgresql://anonshare:anonshare@localhost:5432/anonshare';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.STORAGE_ENDPOINT = 'http://localhost:9000';
    process.env.STORAGE_ACCESS_KEY_ID = 'minioadmin';
    process.env.STORAGE_SECRET_ACCESS_KEY = 'minioadmin';
    process.env.STORAGE_BUCKET = 'anonshare';
    process.env.GITHUB_CLIENT_ID = 'github-client-id';
    process.env.GITHUB_CLIENT_SECRET = 'github-client-secret';
    process.env.GITHUB_ALLOWED_USER_ID = '123456';

    process.env.SESSION_SECRET = 'too-short';
    expect(() => validateApiEnv()).toThrow('SESSION_SECRET');

    process.env.SESSION_SECRET = 'a'.repeat(31);
    expect(() => validateApiEnv()).toThrow('SESSION_SECRET');

    process.env.SESSION_SECRET = 'a'.repeat(32);
    expect(() => validateApiEnv()).not.toThrow();
  });

  test('validateWorkerEnv requires storage and connection settings', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_BASE_URL = 'https://anonshare.dev';
    process.env.DATABASE_URL = 'postgresql://anonshare:anonshare@localhost:5432/anonshare';
    process.env.REDIS_URL = 'redis://localhost:6379';

    expect(() => validateWorkerEnv()).toThrow(/STORAGE_/);
  });

  test('validateWorkerEnv returns the worker health port with a safe default', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_BASE_URL = 'https://anonshare.dev';
    process.env.DATABASE_URL = 'postgresql://anonshare:anonshare@localhost:5432/anonshare';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.STORAGE_ENDPOINT = 'https://storage.example.com';
    process.env.STORAGE_ACCESS_KEY_ID = 'access-key';
    process.env.STORAGE_SECRET_ACCESS_KEY = 'secret-key';
    process.env.STORAGE_BUCKET = 'anonshare-prod';

    expect(validateWorkerEnv()).toMatchObject({
      appBaseUrl: 'https://anonshare.dev',
      appEnv: 'production',
      healthPort: 3002
    });

    process.env.WORKER_HEALTH_PORT = '4100';

    expect(validateWorkerEnv()).toMatchObject({ healthPort: 4100 });
  });

  test('validateWebEnv rejects malformed API URLs', () => {
    process.env.APP_BASE_URL = 'http://localhost:3000';
    process.env.APP_API_URL = 'localhost:3001';

    expect(() => validateWebEnv()).toThrow('APP_API_URL');
  });
});
