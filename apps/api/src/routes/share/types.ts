import type { createDb } from '@anonshare/infrastructure/db';
import type { Redis } from '@anonshare/infrastructure/redis';
import type { StorageSignedUrlOptions } from '@anonshare/infrastructure/storage';

export type ShareStorage = {
  createSignedUrl(key: string, options: StorageSignedUrlOptions): Promise<string>;
};

export type ShareRouterDeps = {
  getDb?: () => ReturnType<typeof createDb>;
  storage?: ShareStorage;
  enqueueCleanupFile?: (fileId: string, objectKey: string, delayMs?: number) => Promise<void>;
  getRedis?: () => Redis;
  loadDownloadRateLimit?: () => Promise<number>;
};

export type ResolvedShareDeps = {
  db: () => ReturnType<typeof createDb>;
  storage: ShareStorage;
  enqueueCleanupFile: (fileId: string, objectKey: string, delayMs?: number) => Promise<void>;
  redis: () => Redis;
  loadDownloadRateLimit: () => Promise<number>;
};
