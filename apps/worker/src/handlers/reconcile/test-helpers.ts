/**
 * Shared test doubles and builders for the reconcile handler test suite.
 * Imported by the per-pass test files.
 */

import type {
  CleanupFileJobPayload,
  ExpireFileJobPayload,
  ReconcileJobPayload
} from '@anonshare/contracts';
import type { createDb } from '@anonshare/infrastructure/db';
import type { Job, Queue } from 'bullmq';
import type { ReconcileHandlerDeps } from './types';

export type SelectFileRow = {
  id: string;
  objectKey: string;
  cursorTimestamp?: Date | null;
  status?: string;
  consumedAt?: Date | null;
  expiresAt?: Date | null;
  uploadedAt?: Date;
};

export type DbStubs = {
  /** Results for each successive db.select().from().where() call across reconcile passes. */
  selectSequence?: SelectFileRow[][];
  /** Captures every .limit(n) used by select chains. */
  capturedSelectLimits?: number[];
  /** Results for each successive db.update().returning() call in order. */
  updateSequence?: Array<{ id: string }[]>;
  /** What to return for operationalAnomalies.findFirst (null = no existing). */
  anomalyFindFirstReturn?: unknown;
  /** Captures anomaly inserts. */
  capturedAnomalies?: Array<{ type: string; fileId: string | null; details: unknown }>;
  /** Captures file deletions (Pass C). */
  capturedDeletes?: string[];
};

export type StorageStubs = {
  /** Per objectKey: true/false/throws. Default: true (exists). */
  existsResults?: Record<string, boolean | Error>;
  /** Return value for storage.list(). */
  listResult?: {
    objects: Array<{ key: string; size: number; lastModified: Date | null; etag: string | null }>;
    isTruncated?: boolean;
    nextStartAfter?: string | null;
  };
  /** Sequential return values for paginated storage.list() calls. */
  listResults?: Array<{
    objects: Array<{ key: string; size: number; lastModified: Date | null; etag: string | null }>;
    isTruncated?: boolean;
    nextStartAfter?: string | null;
  }>;
  listShouldThrow?: boolean;
  capturedListOptions?: Array<unknown>;
};

export type CursorStubs = {
  initialFutureExpirationCursor?: string;
  capturedPersistedFutureExpirationCursors?: Array<string | null>;
  futureLoadShouldThrow?: boolean;
  futurePersistShouldThrow?: boolean;
  initialMissingObjectCursor?: string;
  capturedPersistedMissingObjectCursors?: Array<string | null>;
  missingLoadShouldThrow?: boolean;
  missingPersistShouldThrow?: boolean;
  initialTerminalCleanupCursor?: string;
  capturedPersistedTerminalCleanupCursors?: Array<string | null>;
  terminalLoadShouldThrow?: boolean;
  terminalPersistShouldThrow?: boolean;
  initialOrphanCursor?: string;
  capturedPersistedOrphanCursors?: Array<string | null>;
  orphanLoadShouldThrow?: boolean;
  orphanPersistShouldThrow?: boolean;
};

export type MockedQueueJobState =
  | 'waiting'
  | 'active'
  | 'delayed'
  | 'prioritized'
  | 'waiting-children'
  | 'completed'
  | 'failed'
  | 'unknown';

export type QueueAddOptions = {
  jobId?: string;
  delay?: number;
  attempts?: number;
  backoff?: { type?: string; delay?: number };
  removeOnComplete?: number;
  removeOnFail?: number;
};

export type QueueStubs = {
  capturedCleanupAdds?: Array<{ data: CleanupFileJobPayload; opts: QueueAddOptions }>;
  capturedExpireAdds?: Array<{ data: ExpireFileJobPayload; opts: QueueAddOptions }>;
  capturedRemovedCleanupJobIds?: string[];
  capturedRemovedExpireJobIds?: string[];
  cleanupPendingJobs?: Array<{ id?: string | number; data?: { fileId?: string } }>;
  expirePendingJobs?: Array<{ id?: string | number; data?: { fileId?: string } }>;
  cleanupGetJobsShouldThrow?: boolean;
  expireGetJobsShouldThrow?: boolean;
  existingCleanupJobs?: Record<string, boolean>;
  existingExpireJobs?: Record<string, boolean>;
  existingCleanupJobLookupErrors?: Record<string, Error>;
  existingExpireJobLookupErrors?: Record<string, Error>;
  existingCleanupJobStates?: Record<string, MockedQueueJobState>;
  existingExpireJobStates?: Record<string, MockedQueueJobState>;
  existingCleanupJobStateErrors?: Record<string, Error>;
  existingExpireJobStateErrors?: Record<string, Error>;
  existingCleanupJobTimestamps?: Record<string, number>;
  existingExpireJobTimestamps?: Record<string, number>;
  existingCleanupJobDelays?: Record<string, number>;
  existingExpireJobDelays?: Record<string, number>;
};

/**
 * Builds a minimal ReconcileHandlerDeps where the DB surface
 * is mocked with call-sequence arrays to avoid Drizzle ORM coupling.
 */
export function makeMockDeps(
  db: DbStubs = {},
  storage: StorageStubs = {},
  queues: QueueStubs = {},
  cursor: CursorStubs = {}
): ReconcileHandlerDeps {
  let selectCallIdx = 0;
  let updateCallIdx = 0;
  let listCallIdx = 0;
  const capturedAnomalies: Array<{ type: string; fileId: string | null; details: unknown }> = [];
  const capturedDeletes: string[] = [];
  const capturedSelectLimits: number[] = [];
  const capturedCleanupAdds: Array<{ data: CleanupFileJobPayload; opts: QueueAddOptions }> = [];
  const capturedExpireAdds: Array<{ data: ExpireFileJobPayload; opts: QueueAddOptions }> = [];
  const capturedRemovedCleanupJobIds: string[] = [];
  const capturedRemovedExpireJobIds: string[] = [];
  const capturedListOptions: unknown[] = [];
  const capturedPersistedFutureExpirationCursors: Array<string | null> = [];
  const capturedPersistedMissingObjectCursors: Array<string | null> = [];
  const capturedPersistedTerminalCleanupCursors: Array<string | null> = [];
  const capturedPersistedOrphanCursors: Array<string | null> = [];

  db.capturedAnomalies = capturedAnomalies;
  db.capturedDeletes = capturedDeletes;
  db.capturedSelectLimits = capturedSelectLimits;
  queues.capturedCleanupAdds = capturedCleanupAdds;
  queues.capturedExpireAdds = capturedExpireAdds;
  queues.capturedRemovedCleanupJobIds = capturedRemovedCleanupJobIds;
  queues.capturedRemovedExpireJobIds = capturedRemovedExpireJobIds;
  storage.capturedListOptions = capturedListOptions;
  cursor.capturedPersistedFutureExpirationCursors = capturedPersistedFutureExpirationCursors;
  cursor.capturedPersistedMissingObjectCursors = capturedPersistedMissingObjectCursors;
  cursor.capturedPersistedTerminalCleanupCursors = capturedPersistedTerminalCleanupCursors;
  cursor.capturedPersistedOrphanCursors = capturedPersistedOrphanCursors;

  // Build a thenable+chainable object for select results
  function makeSelectChain(data: SelectFileRow[]) {
    // Extend a real Promise with the extra Drizzle builder chain methods so
    // `await chain`, `.limit(n)`, and `.orderBy(col).limit(n)` all work.
    return Object.assign(Promise.resolve(data), {
      limit: (n: number) => {
        capturedSelectLimits.push(n);
        return Promise.resolve(data);
      },
      orderBy: (_col: unknown) => ({
        limit: (n: number) => {
          capturedSelectLimits.push(n);
          return Promise.resolve(data);
        }
      })
    });
  }

  return {
    db: {
      select: (_cols: unknown) => ({
        from: (_tbl: unknown) => {
          const idx = selectCallIdx++;
          const data = db.selectSequence?.[idx] ?? [];
          return {
            where: (_cond: unknown) => makeSelectChain(data)
          };
        }
      }),

      update: (_tbl: unknown) => ({
        set: (_vals: unknown) => ({
          where: (_cond: unknown) => ({
            returning: async (_cols: unknown) => {
              const idx = updateCallIdx++;
              return db.updateSequence?.[idx] ?? [{ id: 'default-updated-id' }];
            }
          })
        })
      }),

      delete: (_tbl: unknown) => ({
        where: async (_cond: unknown) => {
          capturedDeletes.push('deleted');
        }
      }),

      insert: (_tbl: unknown) => ({
        values: async (vals: { type: string; fileId: string | null; details: unknown }) => {
          capturedAnomalies.push(vals);
        }
      }),

      query: {
        operationalAnomalies: {
          findFirst: async (_opts: unknown) => {
            return db.anomalyFindFirstReturn ?? null;
          }
        }
      }
    } as unknown as ReturnType<typeof createDb>,

    storage: {
      exists: async (key: string) => {
        const result = storage.existsResults?.[key];
        if (result instanceof Error) throw result;
        return result !== undefined ? result : true; // default: exists
      },
      list: async (_options?: unknown) => {
        if (storage.listShouldThrow) {
          throw new Error('storage list failed');
        }

        capturedListOptions.push(_options);

        const result = storage.listResults?.[listCallIdx++] ?? storage.listResult;

        return {
          objects: result?.objects ?? [],
          isTruncated: result?.isTruncated ?? false,
          nextStartAfter: result?.nextStartAfter ?? null
        };
      }
    },

    cleanupQueue: {
      add: async (_name: string, data: CleanupFileJobPayload, opts: unknown) => {
        capturedCleanupAdds.push({
          data,
          opts: opts as QueueAddOptions
        });
        return {} as ReturnType<Queue['add']>;
      },
      getJobs: async (
        _types: Array<'waiting' | 'active' | 'delayed' | 'prioritized' | 'waiting-children'>,
        _start: number,
        _end: number
      ) => {
        if (queues.cleanupGetJobsShouldThrow) {
          throw new Error('cleanup getJobs failed');
        }

        return (queues.cleanupPendingJobs ?? []).map((pendingJob) => ({
          id: pendingJob.id,
          data: pendingJob.data ?? {}
        })) as Array<{ id: string | number | undefined; data: { fileId?: string } }>;
      },
      getJob: async (jobId: string) => {
        const lookupError = queues.existingCleanupJobLookupErrors?.[jobId];
        if (lookupError) {
          throw lookupError;
        }

        const state = queues.existingCleanupJobStates?.[jobId];
        if (state === undefined && !queues.existingCleanupJobs?.[jobId]) {
          return undefined;
        }

        return {
          id: jobId,
          getState: async () => {
            const err = queues.existingCleanupJobStateErrors?.[jobId];
            if (err) {
              throw err;
            }

            return state ?? 'waiting';
          },
          timestamp: queues.existingCleanupJobTimestamps?.[jobId],
          delay: queues.existingCleanupJobDelays?.[jobId],
          remove: async () => {
            capturedRemovedCleanupJobIds.push(jobId);
          }
        } as object;
      }
    } as unknown as Queue<CleanupFileJobPayload>,

    expireQueue: {
      add: async (_name: string, data: ExpireFileJobPayload, opts: unknown) => {
        capturedExpireAdds.push({
          data,
          opts: opts as QueueAddOptions
        });
        return {} as ReturnType<Queue['add']>;
      },
      getJobs: async (
        _types: Array<'waiting' | 'active' | 'delayed' | 'prioritized' | 'waiting-children'>,
        _start: number,
        _end: number
      ) => {
        if (queues.expireGetJobsShouldThrow) {
          throw new Error('expire getJobs failed');
        }

        return (queues.expirePendingJobs ?? []).map((pendingJob) => ({
          id: pendingJob.id,
          data: pendingJob.data ?? {}
        })) as Array<{ id: string | number | undefined; data: { fileId?: string } }>;
      },
      getJob: async (jobId: string) => {
        const lookupError = queues.existingExpireJobLookupErrors?.[jobId];
        if (lookupError) {
          throw lookupError;
        }

        const state = queues.existingExpireJobStates?.[jobId];
        if (state === undefined && !queues.existingExpireJobs?.[jobId]) {
          return undefined;
        }

        return {
          id: jobId,
          getState: async () => {
            const err = queues.existingExpireJobStateErrors?.[jobId];
            if (err) {
              throw err;
            }

            return state ?? 'waiting';
          },
          timestamp: queues.existingExpireJobTimestamps?.[jobId],
          delay: queues.existingExpireJobDelays?.[jobId],
          remove: async () => {
            capturedRemovedExpireJobIds.push(jobId);
          }
        } as object;
      }
    } as unknown as Queue<ExpireFileJobPayload>,

    getFutureExpirationCursor: async () => {
      if (cursor.futureLoadShouldThrow) {
        throw new Error('future cursor load failed');
      }

      return cursor.initialFutureExpirationCursor;
    },

    setFutureExpirationCursor: async (value: string | null) => {
      capturedPersistedFutureExpirationCursors.push(value);

      if (cursor.futurePersistShouldThrow) {
        throw new Error('future cursor persist failed');
      }
    },

    getMissingObjectCursor: async () => {
      if (cursor.missingLoadShouldThrow) {
        throw new Error('missing-object cursor load failed');
      }

      return cursor.initialMissingObjectCursor;
    },

    setMissingObjectCursor: async (value: string | null) => {
      capturedPersistedMissingObjectCursors.push(value);

      if (cursor.missingPersistShouldThrow) {
        throw new Error('missing-object cursor persist failed');
      }
    },

    getTerminalCleanupCursor: async () => {
      if (cursor.terminalLoadShouldThrow) {
        throw new Error('terminal-cleanup cursor load failed');
      }

      return cursor.initialTerminalCleanupCursor;
    },

    setTerminalCleanupCursor: async (value: string | null) => {
      capturedPersistedTerminalCleanupCursors.push(value);

      if (cursor.terminalPersistShouldThrow) {
        throw new Error('terminal-cleanup cursor persist failed');
      }
    },

    getOrphanScanCursor: async () => {
      if (cursor.orphanLoadShouldThrow) {
        throw new Error('cursor load failed');
      }

      return cursor.initialOrphanCursor;
    },

    setOrphanScanCursor: async (value: string | null) => {
      capturedPersistedOrphanCursors.push(value);

      if (cursor.orphanPersistShouldThrow) {
        throw new Error('cursor persist failed');
      }
    }
  };
}

export function makeJob(overrides: Partial<ReconcileJobPayload> = {}): Job<ReconcileJobPayload> {
  return {
    data: { ...overrides }
  } as unknown as Job<ReconcileJobPayload>;
}

/** 2 hours + 1 second in milliseconds → exceeds the stale-expiration anomaly threshold */
export const OVER_ANOMALY_THRESHOLD_MS = 2 * 60 * 60 * 1000 + 1_000;
