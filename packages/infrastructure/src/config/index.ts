/**
 * Centralised, validated environment access.
 *
 * Every process (web, api, worker) imports only the variables it needs.
 * Boot fails fast with an explicit message when a required variable is absent.
 */

export type RuntimeEnvironment = 'development' | 'production' | 'test';

type MutableEnvironment = Record<string, string | undefined>;

const HTTP_PROTOCOLS = ['http:', 'https:'] as const;
const POSTGRES_PROTOCOLS = ['postgres:', 'postgresql:'] as const;
const REDIS_PROTOCOLS = ['redis:', 'rediss:'] as const;
const RUNTIME_ENVIRONMENTS = ['development', 'production', 'test'] as const;

function require(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `[config] Missing required environment variable: ${key}\n` +
        `Copy the root .env.example to .env and fill in the value.`
    );
  }
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function assignIfMissing(env: MutableEnvironment, key: string, value: string): void {
  if (!env[key]) {
    env[key] = value;
  }
}

function validateUrl(
  key: string,
  value: string,
  allowedProtocols: readonly string[],
  options?: { trimTrailingSlash?: boolean }
): string {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`[config] Invalid URL for environment variable: ${key}`);
  }

  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error(
      `[config] Invalid protocol for environment variable: ${key}. ` +
        `Expected one of ${allowedProtocols.join(', ')}.`
    );
  }

  const normalized = parsed.toString();

  if (options?.trimTrailingSlash && normalized.endsWith('/')) {
    return normalized.slice(0, -1);
  }

  return normalized;
}

function requireUrl(key: string, allowedProtocols: readonly string[]): string {
  return validateUrl(key, require(key), allowedProtocols);
}

function requireHttpUrl(key: string): string {
  return validateUrl(key, require(key), HTTP_PROTOCOLS, { trimTrailingSlash: true });
}

function optionalHttpUrl(key: string, fallback: string): string {
  return validateUrl(key, optional(key, fallback), HTTP_PROTOCOLS, { trimTrailingSlash: true });
}

function optionalPort(key: string, fallback: number): number {
  const value = process.env[key] ?? String(fallback);
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(
      `[config] Invalid port for environment variable: ${key}. ` +
        `Expected an integer between 1 and 65535.`
    );
  }

  return parsed;
}

function requireRuntimeEnvironment(key: string, fallback: RuntimeEnvironment): RuntimeEnvironment {
  const value = process.env[key] ?? fallback;

  if (!RUNTIME_ENVIRONMENTS.includes(value as RuntimeEnvironment)) {
    throw new Error(
      `[config] Invalid environment variable: ${key}. ` +
        `Expected one of ${RUNTIME_ENVIRONMENTS.join(', ')}.`
    );
  }

  return value as RuntimeEnvironment;
}

export function deriveLocalPlatformEnv(env: MutableEnvironment = process.env): void {
  const postgresUser = env.POSTGRES_USER ?? 'anonshare';
  const postgresPassword = env.POSTGRES_PASSWORD ?? 'anonshare';
  const postgresDatabase = env.POSTGRES_DB ?? 'anonshare';
  const postgresPort = env.POSTGRES_PORT ?? '5432';
  const redisPort = env.REDIS_PORT ?? '6379';
  const minioRootUser = env.MINIO_ROOT_USER ?? 'minioadmin';
  const minioRootPassword = env.MINIO_ROOT_PASSWORD ?? 'minioadmin';
  const minioBucket = env.MINIO_BUCKET ?? 'anonshare';
  const minioApiPort = env.MINIO_API_PORT ?? '9000';

  assignIfMissing(
    env,
    'DATABASE_URL',
    `postgresql://${postgresUser}:${postgresPassword}@127.0.0.1:${postgresPort}/${postgresDatabase}`
  );
  assignIfMissing(env, 'REDIS_URL', `redis://127.0.0.1:${redisPort}`);
  assignIfMissing(env, 'STORAGE_ENDPOINT', `http://127.0.0.1:${minioApiPort}`);
  assignIfMissing(env, 'STORAGE_ACCESS_KEY_ID', minioRootUser);
  assignIfMissing(env, 'STORAGE_SECRET_ACCESS_KEY', minioRootPassword);
  assignIfMissing(env, 'STORAGE_BUCKET', minioBucket);
  assignIfMissing(env, 'STORAGE_REGION', 'us-east-1');
}

// ─── Database ────────────────────────────────────────────────────────────────

export const db = {
  url: () => requireUrl('DATABASE_URL', POSTGRES_PROTOCOLS)
} as const;

// ─── Redis ───────────────────────────────────────────────────────────────────

export const redis = {
  url: () => requireUrl('REDIS_URL', REDIS_PROTOCOLS)
} as const;

// ─── Storage ─────────────────────────────────────────────────────────────────

export const storage = {
  endpoint: () => requireHttpUrl('STORAGE_ENDPOINT'),
  accessKeyId: () => require('STORAGE_ACCESS_KEY_ID'),
  secretAccessKey: () => require('STORAGE_SECRET_ACCESS_KEY'),
  bucket: () => require('STORAGE_BUCKET'),
  region: () => optional('STORAGE_REGION', 'us-east-1'),
  publicBaseUrl: () => {
    const value = optional('STORAGE_PUBLIC_BASE_URL', '');
    return value ? validateUrl('STORAGE_PUBLIC_BASE_URL', value, HTTP_PROTOCOLS) : '';
  }
} as const;

// ─── Application ─────────────────────────────────────────────────────────────

export const app = {
  env: () => requireRuntimeEnvironment('NODE_ENV', 'development'),
  baseUrl: () => optionalHttpUrl('APP_BASE_URL', 'http://localhost:3000'),
  apiUrl: () => optionalHttpUrl('APP_API_URL', 'http://localhost:3001')
} as const;

// ─── Auth (GitHub OAuth) ─────────────────────────────────────────────────────

export const auth = {
  githubClientId: () => require('GITHUB_CLIENT_ID'),
  githubClientSecret: () => require('GITHUB_CLIENT_SECRET'),
  githubAllowedUserId: () => require('GITHUB_ALLOWED_USER_ID'),
  sessionSecret: () => require('SESSION_SECRET')
} as const;

type ValidatedProcessConfig = {
  appEnv: RuntimeEnvironment;
};

export type ValidatedWebConfig = ValidatedProcessConfig & {
  appBaseUrl: string;
  appApiUrl: string;
};

export type ValidatedApiConfig = ValidatedProcessConfig & {
  appBaseUrl: string;
  databaseUrl: string;
  githubAllowedUserId: string;
  githubClientId: string;
  githubClientSecret: string;
  port: number;
  redisUrl: string;
  sessionSecret: string;
  storageAccessKeyId: string;
  storageBucket: string;
  storageEndpoint: string;
  storageRegion: string;
  storageSecretAccessKey: string;
};

export type ValidatedWorkerConfig = ValidatedProcessConfig & {
  appBaseUrl: string;
  databaseUrl: string;
  healthPort: number;
  redisUrl: string;
  storageAccessKeyId: string;
  storageBucket: string;
  storageEndpoint: string;
  storageRegion: string;
  storageSecretAccessKey: string;
};

function validateSharedAppConfig(): Pick<ValidatedProcessConfig, 'appEnv'> {
  return {
    appEnv: app.env()
  };
}

export function validateWebEnv(): ValidatedWebConfig {
  return {
    ...validateSharedAppConfig(),
    appApiUrl: requireHttpUrl('APP_API_URL'),
    appBaseUrl: requireHttpUrl('APP_BASE_URL')
  };
}

export function validateApiEnv(): ValidatedApiConfig {
  return {
    ...validateSharedAppConfig(),
    appBaseUrl: requireHttpUrl('APP_BASE_URL'),
    databaseUrl: db.url(),
    githubAllowedUserId: auth.githubAllowedUserId(),
    githubClientId: auth.githubClientId(),
    githubClientSecret: auth.githubClientSecret(),
    port: optionalPort('PORT', 3001),
    redisUrl: redis.url(),
    sessionSecret: auth.sessionSecret(),
    storageAccessKeyId: storage.accessKeyId(),
    storageBucket: storage.bucket(),
    storageEndpoint: storage.endpoint(),
    storageRegion: storage.region(),
    storageSecretAccessKey: storage.secretAccessKey()
  };
}

export function validateWorkerEnv(): ValidatedWorkerConfig {
  return {
    ...validateSharedAppConfig(),
    appBaseUrl: requireHttpUrl('APP_BASE_URL'),
    databaseUrl: db.url(),
    healthPort: optionalPort('WORKER_HEALTH_PORT', 3002),
    redisUrl: redis.url(),
    storageAccessKeyId: storage.accessKeyId(),
    storageBucket: storage.bucket(),
    storageEndpoint: storage.endpoint(),
    storageRegion: storage.region(),
    storageSecretAccessKey: storage.secretAccessKey()
  };
}

export * from './system-settings';
