import type { Redis } from 'ioredis';

const OAUTH_STATE_PREFIX = 'oauth:state:';

type OAuthStateData = {
  redirectTo: string;
  createdAt: number;
};

/**
 * Durable, restart-safe OAuth pending-state repository backed by Redis.
 *
 * Each pending state is stored as a Redis key with a TTL. Consuming a state
 * atomically deletes it (single-use). No process-local data structures are
 * involved, so the repository works correctly across restarts and potentially
 * across multiple API instances.
 */
export type OAuthStateRepository = {
  /** Persist a new pending state with automatic TTL-based expiration. */
  create(state: string, redirectTo: string, ttlMs: number): Promise<void>;
  /** Read a pending state without consuming it. Returns null if absent or expired. */
  read(state: string): Promise<OAuthStateData | null>;
  /** Atomically consume (read + delete) a pending state. Returns null if already consumed or absent. */
  consume(state: string): Promise<OAuthStateData | null>;
};

export function createOAuthStateRepository(redis: Redis): OAuthStateRepository {
  function key(state: string): string {
    return `${OAUTH_STATE_PREFIX}${state}`;
  }

  return {
    async create(state, redirectTo, ttlMs) {
      const data: OAuthStateData = {
        redirectTo,
        createdAt: Date.now()
      };
      // PX = millisecond TTL; Redis handles automatic expiration
      await redis.set(key(state), JSON.stringify(data), 'PX', ttlMs);
    },

    async read(state) {
      const raw = await redis.get(key(state));
      if (!raw) return null;
      return JSON.parse(raw) as OAuthStateData;
    },

    async consume(state) {
      // GETDEL is atomic — the key is deleted in the same round-trip.
      // Returns null if the key does not exist (already consumed, expired, or never set).
      const raw = await redis.getdel(key(state));
      if (!raw) return null;
      return JSON.parse(raw) as OAuthStateData;
    }
  };
}
