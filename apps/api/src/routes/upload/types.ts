import type { createDb } from '@anonshare/infrastructure/db';
import type { Redis } from '@anonshare/infrastructure/redis';
import type { storageAdapter } from '@anonshare/infrastructure/storage';

export type UploadStorage = Pick<typeof storageAdapter, 'put' | 'head' | 'delete'>;

export type UploadRouterDeps = {
  /** Override the default lazy DB singleton. Useful in tests. */
  getDb?: () => ReturnType<typeof createDb>;
  /** Override the default storage adapter. Useful in tests. */
  storage?: UploadStorage;
  /**
   * Override the default job enqueue function. Useful in tests.
   * Receives the file UUID and the delay in ms from now.
   * Non-fatal: if omitted or if it throws, the reconciler will catch missed expirations.
   */
  enqueueExpireFile?: (fileId: string, delayMs: number) => Promise<void>;
  /**
   * Override the default cleanup enqueue function. Useful in tests.
   * Used when the file has already expired by the time activation finishes.
   */
  enqueueCleanupFile?: (fileId: string, objectKey: string, delayMs?: number) => Promise<void>;
  /** Override the Redis client. Useful in tests. */
  getRedis?: () => Redis;
  /** Override the runtime upload rate-limit loader. Useful in tests. */
  loadUploadRateLimit?: () => Promise<number>;
};
