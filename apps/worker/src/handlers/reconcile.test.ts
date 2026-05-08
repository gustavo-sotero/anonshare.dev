import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import {
  type CleanupFileJobPayload,
  type ExpireFileJobPayload,
  LIFECYCLE_JOB_RETENTION,
  ONE_TIME_DOWNLOAD_CLEANUP_DELAY_MS,
  type ReconcileJobPayload
} from '@anonshare/contracts';
import type { createDb } from '@anonshare/infrastructure/db';
import { logger } from '@anonshare/infrastructure/logger';
import type { Job, Queue } from 'bullmq';
import { makeHandleReconcile, type ReconcileHandlerDeps } from './reconcile';

afterEach(() => {
  mock.restore();
  mock.clearAllMocks();
});

// ── Types ─────────────────────────────────────────────────────────────────────

type SelectFileRow = {
  id: string;
  objectKey: string;
  cursorTimestamp?: Date | null;
  status?: string;
  consumedAt?: Date | null;
  expiresAt?: Date | null;
  uploadedAt?: Date;
};

type DbStubs = {
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
  /** Captures file deletions (Pass B). */
  capturedDeletes?: string[];
};

type StorageStubs = {
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

type CursorStubs = {
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

type MockedQueueJobState =
  | 'waiting'
  | 'active'
  | 'delayed'
  | 'prioritized'
  | 'waiting-children'
  | 'completed'
  | 'failed'
  | 'unknown';

type QueueAddOptions = {
  jobId?: string;
  delay?: number;
  attempts?: number;
  backoff?: { type?: string; delay?: number };
  removeOnComplete?: number;
  removeOnFail?: number;
};

type QueueStubs = {
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

// ── Mock builder ──────────────────────────────────────────────────────────────

/**
 * Builds a minimal ReconcileHandlerDeps where the DB surface
 * is mocked with call-sequence arrays to avoid Drizzle ORM coupling.
 */
function makeMockDeps(
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

function makeJob(overrides: Partial<ReconcileJobPayload> = {}): Job<ReconcileJobPayload> {
  return {
    data: { ...overrides }
  } as unknown as Job<ReconcileJobPayload>;
}

/** 2 hours + 1 second in milliseconds → exceeds the stale-expiration anomaly threshold */
const OVER_ANOMALY_THRESHOLD_MS = 2 * 60 * 60 * 1000 + 1_000;

// ── Pass A: Stale expiration tests ────────────────────────────────────────────

describe('reconcile handler — Pass A: stale expirations', () => {
  test('scans stale expirations in a bounded batch', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], []],
      updateSequence: []
    };
    const deps = makeMockDeps(db, {});

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedSelectLimits).toContain(200);
  });

  test('transitions active file past expiresAt to expired and enqueues cleanup job', async () => {
    const now = new Date();
    const staleFile: SelectFileRow = {
      id: 'stale-1',
      objectKey: 'objects/stale-1',
      expiresAt: new Date(now.getTime() - 5_000)
    };
    const db: DbStubs = {
      selectSequence: [[staleFile], [], []], // PassA=stale file, PassB=none, PassC=none
      updateSequence: [[{ id: 'stale-1' }]]
    };
    const queues: QueueStubs = {};
    const deps = makeMockDeps(db, {}, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedCleanupAdds).toHaveLength(1);
    expect(queues.capturedCleanupAdds?.[0]?.data.fileId).toBe('stale-1');
    expect(queues.capturedCleanupAdds?.[0]?.data.objectKey).toBe('objects/stale-1');
    expect(queues.capturedCleanupAdds?.[0]?.opts.jobId).toBe('cleanup:stale-1');
    expect(queues.capturedCleanupAdds?.[0]?.opts.removeOnComplete).toBe(
      LIFECYCLE_JOB_RETENTION.removeOnComplete
    );
    expect(queues.capturedCleanupAdds?.[0]?.opts.removeOnFail).toBe(
      LIFECYCLE_JOB_RETENTION.removeOnFail
    );
  });

  test('skips cleanup enqueue when concurrent update already changed the status (0 rows)', async () => {
    const now = new Date();
    const staleFile: SelectFileRow = {
      id: 'stale-race',
      objectKey: 'objects/race',
      expiresAt: new Date(now.getTime() - 5_000)
    };
    const db: DbStubs = {
      selectSequence: [[staleFile], [], []],
      updateSequence: [[]] // 0 rows = already updated concurrently
    };
    const queues: QueueStubs = {};
    const deps = makeMockDeps(db, {}, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedCleanupAdds).toHaveLength(0);
  });

  test('continues reconcile when expire queue job lookup fails during repair pass', async () => {
    const now = new Date();
    const db: DbStubs = {
      selectSequence: [
        [],
        [
          { id: 'future-file', expiresAt: new Date(now.getTime() + 60_000), objectKey: 'objects/f' }
        ],
        []
      ],
      anomalyFindFirstReturn: null
    };
    const queues: QueueStubs = {
      existingExpireJobLookupErrors: {
        'expire:future-file': new Error('redis unavailable')
      }
    };
    const deps = makeMockDeps(db, {}, queues);

    await makeHandleReconcile(deps)(makeJob({ olderThan: now.toISOString() }));

    expect(queues.capturedExpireAdds).toHaveLength(0);
    expect(db.capturedAnomalies).toContainEqual(
      expect.objectContaining({
        type: 'reconciliation_scan_incomplete',
        fileId: 'future-file',
        details: expect.objectContaining({
          queue: 'expire-file',
          operation: 'getJob',
          reason: 'queue_read_failed'
        })
      })
    );
  });

  test('records anomaly only for significantly overdue files (> 2 hours)', async () => {
    const now = new Date();
    const overdueMs = OVER_ANOMALY_THRESHOLD_MS;
    const staleFile: SelectFileRow = {
      id: 'very-stale',
      objectKey: 'objects/stale-2',
      expiresAt: new Date(now.getTime() - overdueMs)
    };
    const db: DbStubs = {
      selectSequence: [[staleFile], [], []],
      updateSequence: [[{ id: 'very-stale' }]],
      anomalyFindFirstReturn: null // no existing anomaly
    };
    const deps = makeMockDeps(db, {});

    // Use a fixed olderThan so the overdue calculation is deterministic
    await makeHandleReconcile(deps)(makeJob({ olderThan: now.toISOString() }));

    expect(db.capturedAnomalies).toHaveLength(1);
    expect(db.capturedAnomalies?.[0]?.type).toBe('stale_expiration');
    expect(db.capturedAnomalies?.[0]?.fileId).toBe('very-stale');
  });

  test('does not record anomaly when file is only slightly overdue (< 2 hours)', async () => {
    const now = new Date();
    const slightlyOverdueMs = 30 * 60 * 1000; // 30 minutes
    const staleFile: SelectFileRow = {
      id: 'slightly-stale',
      objectKey: 'objects/slight',
      expiresAt: new Date(now.getTime() - slightlyOverdueMs)
    };
    const db: DbStubs = {
      selectSequence: [[staleFile], [], []],
      updateSequence: [[{ id: 'slightly-stale' }]]
    };
    const deps = makeMockDeps(db, {});

    await makeHandleReconcile(deps)(makeJob({ olderThan: now.toISOString() }));

    expect(db.capturedAnomalies).toHaveLength(0);
  });

  test('does not insert duplicate anomaly when one already exists for that file', async () => {
    const now = new Date();
    const staleFile: SelectFileRow = {
      id: 'dup-stale',
      objectKey: 'objects/dup',
      expiresAt: new Date(now.getTime() - OVER_ANOMALY_THRESHOLD_MS)
    };
    const db: DbStubs = {
      selectSequence: [[staleFile], [], []],
      updateSequence: [[{ id: 'dup-stale' }]],
      anomalyFindFirstReturn: { id: 'existing-anomaly' } // anomaly already exists
    };
    const deps = makeMockDeps(db, {});

    await makeHandleReconcile(deps)(makeJob({ olderThan: now.toISOString() }));

    // No new anomaly inserted because one already exists
    expect(db.capturedAnomalies).toHaveLength(0);
  });
});

// ── Pass B: Missing future expiration jobs ──────────────────────────────────

describe('reconcile handler — Pass B: future expiration job repair', () => {
  test('records an anomaly and clears an invalid future-expiration cursor', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], [], [], []],
      anomalyFindFirstReturn: null
    };
    const cursor: CursorStubs = {
      initialFutureExpirationCursor: 'not-a-valid-cursor'
    };
    const deps = makeMockDeps(db, {}, {}, cursor);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toContainEqual(
      expect.objectContaining({
        type: 'reconciliation_scan_incomplete',
        fileId: null,
        details: expect.objectContaining({
          queue: 'reconcile',
          cursor: 'future_expiration',
          reason: 'cursor_invalid',
          rawCursor: 'not-a-valid-cursor'
        })
      })
    );
    expect(cursor.capturedPersistedFutureExpirationCursors).toContain(null);
  });

  test('records an anomaly when the future-expiration cursor cannot be loaded', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], [], [], []],
      anomalyFindFirstReturn: null
    };
    const cursor: CursorStubs = {
      futureLoadShouldThrow: true
    };
    const deps = makeMockDeps(db, {}, {}, cursor);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toContainEqual(
      expect.objectContaining({
        type: 'reconciliation_scan_incomplete',
        fileId: null,
        details: expect.objectContaining({
          queue: 'reconcile',
          cursor: 'future_expiration',
          reason: 'cursor_read_failed'
        })
      })
    );
  });

  test('re-enqueues expire-file when a future-expiring file has no delayed job', async () => {
    const futureFile: SelectFileRow = {
      id: 'future-expire',
      objectKey: 'objects/future-expire',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    };
    const db: DbStubs = {
      selectSequence: [[], [futureFile], [], [], []]
    };
    const queues: QueueStubs = {};
    const deps = makeMockDeps(db, {}, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedExpireAdds).toHaveLength(1);
    expect(queues.capturedExpireAdds?.[0]?.data.fileId).toBe('future-expire');
    expect(queues.capturedExpireAdds?.[0]?.opts.jobId).toBe('expire:future-expire');
    expect(queues.capturedExpireAdds?.[0]?.opts.removeOnComplete).toBe(
      LIFECYCLE_JOB_RETENTION.removeOnComplete
    );
    expect(queues.capturedExpireAdds?.[0]?.opts.removeOnFail).toBe(
      LIFECYCLE_JOB_RETENTION.removeOnFail
    );
  });

  test('persists a future-expiration cursor when the repair scan fills its batch', async () => {
    const futureFiles: SelectFileRow[] = Array.from({ length: 100 }, (_, idx) => ({
      id: `future-batch-${idx}`,
      objectKey: `objects/future-batch-${idx}`,
      expiresAt: new Date(Date.parse('2030-01-01T00:00:00.000Z') + idx * 1_000),
      cursorTimestamp: new Date(Date.parse('2030-01-01T00:00:00.000Z') + idx * 1_000)
    }));
    const db: DbStubs = {
      selectSequence: [[], futureFiles, [], [], []]
    };
    const cursor: CursorStubs = {
      initialFutureExpirationCursor: '2029-12-31T23:59:00.000Z|future-batch-prev'
    };
    const deps = makeMockDeps(db, {}, {}, cursor);

    await makeHandleReconcile(deps)(makeJob());

    expect(cursor.capturedPersistedFutureExpirationCursors).toEqual([
      '2030-01-01T00:01:39.000Z|future-batch-99'
    ]);
  });

  test('records an anomaly when future-expiration cursor persistence fails', async () => {
    const futureFiles: SelectFileRow[] = Array.from({ length: 100 }, (_, idx) => ({
      id: `future-persist-${idx}`,
      objectKey: `objects/future-persist-${idx}`,
      expiresAt: new Date(Date.parse('2031-01-01T00:00:00.000Z') + idx * 1_000),
      cursorTimestamp: new Date(Date.parse('2031-01-01T00:00:00.000Z') + idx * 1_000)
    }));
    const db: DbStubs = {
      selectSequence: [[], futureFiles, [], [], []],
      anomalyFindFirstReturn: null
    };
    const cursor: CursorStubs = {
      futurePersistShouldThrow: true
    };
    const deps = makeMockDeps(db, {}, {}, cursor);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toContainEqual(
      expect.objectContaining({
        type: 'reconciliation_scan_incomplete',
        fileId: null,
        details: expect.objectContaining({
          queue: 'reconcile',
          cursor: 'future_expiration',
          reason: 'cursor_write_failed'
        })
      })
    );
    expect(cursor.capturedPersistedFutureExpirationCursors).toEqual([
      '2031-01-01T00:01:39.000Z|future-persist-99'
    ]);
  });

  test('re-enqueues expire-file when existing job is terminal (completed)', async () => {
    const futureFile: SelectFileRow = {
      id: 'future-terminal',
      objectKey: 'objects/future-terminal',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    };
    const db: DbStubs = {
      selectSequence: [[], [futureFile], [], [], []]
    };
    const queues: QueueStubs = {
      existingExpireJobStates: { 'expire:future-terminal': 'completed' }
    };
    const deps = makeMockDeps(db, {}, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedRemovedExpireJobIds).toEqual(['expire:future-terminal']);
    expect(queues.capturedExpireAdds).toHaveLength(1);
    expect(queues.capturedExpireAdds?.[0]?.opts.jobId).toBe('expire:future-terminal');
  });

  test('re-enqueues expire-file when existing job is terminal (failed)', async () => {
    const futureFile: SelectFileRow = {
      id: 'future-terminal-failed',
      objectKey: 'objects/future-terminal-failed',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    };
    const db: DbStubs = {
      selectSequence: [[], [futureFile], [], [], []]
    };
    const queues: QueueStubs = {
      existingExpireJobStates: { 'expire:future-terminal-failed': 'failed' }
    };
    const deps = makeMockDeps(db, {}, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedRemovedExpireJobIds).toEqual(['expire:future-terminal-failed']);
    expect(queues.capturedExpireAdds).toHaveLength(1);
    expect(queues.capturedExpireAdds?.[0]?.opts.jobId).toBe('expire:future-terminal-failed');
  });

  test('does not re-enqueue expire-file when the delayed job already exists', async () => {
    const futureFile: SelectFileRow = {
      id: 'future-existing',
      objectKey: 'objects/future-existing',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    };
    const db: DbStubs = {
      selectSequence: [[], [futureFile], [], [], []]
    };
    const queues: QueueStubs = {
      existingExpireJobStates: { 'expire:future-existing': 'waiting' }
    };
    const deps = makeMockDeps(db, {}, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedExpireAdds).toHaveLength(0);
  });

  test('logs overdue anomaly when existing expire job is still pending long after scheduled time', async () => {
    const futureFile: SelectFileRow = {
      id: 'future-overdue-job',
      objectKey: 'objects/future-overdue-job',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    };
    const db: DbStubs = {
      selectSequence: [[], [futureFile], [], [], []]
    };
    const queuedAt = Date.now() - 20 * 60 * 1000;
    const queues: QueueStubs = {
      existingExpireJobStates: { 'expire:future-overdue-job': 'delayed' },
      existingExpireJobTimestamps: { 'expire:future-overdue-job': queuedAt },
      existingExpireJobDelays: { 'expire:future-overdue-job': 0 }
    };
    const deps = makeMockDeps(db, {}, queues);
    const warnSpy = spyOn(logger, 'warn');

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedExpireAdds).toHaveLength(0);
    expect(db.capturedAnomalies).toHaveLength(1);
    expect(db.capturedAnomalies?.[0]).toMatchObject({
      type: 'lifecycle_job_overdue',
      fileId: 'future-overdue-job'
    });
    expect(warnSpy).toHaveBeenCalledWith(
      'Reconcile: existing lifecycle job is pending but overdue',
      expect.objectContaining({
        event: 'reconciliation.anomaly_detected',
        anomalyType: 'lifecycle_job_overdue',
        queue: 'expire-file',
        state: 'delayed',
        reason: 'pending_job_overdue',
        entity: { type: 'file', id: 'future-overdue-job' }
      })
    );
  });
});

// ── Pass C: Stuck pending_upload tests ──────────────────────────────────────

describe('reconcile handler — Pass B: stuck pending_upload', () => {
  test('promotes stuck pending_upload to active when object exists in storage', async () => {
    const stuckFile: SelectFileRow = {
      id: 'stuck-1',
      objectKey: 'objects/stuck-1',
      expiresAt: null,
      uploadedAt: new Date(Date.now() - 20 * 60 * 1000) // 20 minutes ago
    };
    const db: DbStubs = {
      selectSequence: [[], [], [stuckFile], [], []],
      updateSequence: [[{ id: 'stuck-1' }]]
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/stuck-1': true }
    };
    const deps = makeMockDeps(db, storage);

    await makeHandleReconcile(deps)(makeJob());

    // Update was called to promote to active
    expect(db.capturedDeletes).toHaveLength(0);
  });

  test('promotes stuck pending_upload directly to expired and enqueues cleanup when expiresAt already passed', async () => {
    const alreadyExpired = new Date(Date.now() - 60 * 1000);
    const stuckFile: SelectFileRow = {
      id: 'stuck-expired',
      objectKey: 'objects/stuck-expired',
      expiresAt: alreadyExpired,
      uploadedAt: new Date(Date.now() - 20 * 60 * 1000)
    };
    const db: DbStubs = {
      selectSequence: [[], [], [stuckFile], [], []],
      updateSequence: [[{ id: 'stuck-expired' }]]
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/stuck-expired': true }
    };
    const queues: QueueStubs = {};
    const deps = makeMockDeps(db, storage, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedCleanupAdds).toHaveLength(1);
    expect(queues.capturedCleanupAdds?.[0]?.data.fileId).toBe('stuck-expired');
    expect(queues.capturedCleanupAdds?.[0]?.opts.jobId).toBe('cleanup:stuck-expired');
    expect(queues.capturedExpireAdds).toHaveLength(0);
  });

  test('re-schedules expiration job when promoting stuck pending with future expiresAt', async () => {
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour ahead
    const stuckFile: SelectFileRow = {
      id: 'stuck-exp',
      objectKey: 'objects/stuck-exp',
      expiresAt: futureExpiry,
      uploadedAt: new Date(Date.now() - 20 * 60 * 1000)
    };
    const db: DbStubs = {
      selectSequence: [[], [], [stuckFile], [], []],
      updateSequence: [[{ id: 'stuck-exp' }]]
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/stuck-exp': true }
    };
    const queues: QueueStubs = {};
    const deps = makeMockDeps(db, storage, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedExpireAdds).toHaveLength(1);
    expect(queues.capturedExpireAdds?.[0]?.data.fileId).toBe('stuck-exp');
    expect(queues.capturedExpireAdds?.[0]?.opts.jobId).toBe('expire:stuck-exp');
  });

  test('re-schedules expiration job when existing expire job is terminal for promoted pending file', async () => {
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000);
    const stuckFile: SelectFileRow = {
      id: 'stuck-exp-terminal',
      objectKey: 'objects/stuck-exp-terminal',
      expiresAt: futureExpiry,
      uploadedAt: new Date(Date.now() - 20 * 60 * 1000)
    };
    const db: DbStubs = {
      selectSequence: [[], [], [stuckFile], [], []],
      updateSequence: [[{ id: 'stuck-exp-terminal' }]]
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/stuck-exp-terminal': true }
    };
    const queues: QueueStubs = {
      existingExpireJobStates: { 'expire:stuck-exp-terminal': 'failed' }
    };
    const deps = makeMockDeps(db, storage, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedRemovedExpireJobIds).toEqual(['expire:stuck-exp-terminal']);
    expect(queues.capturedExpireAdds).toHaveLength(1);
    expect(queues.capturedExpireAdds?.[0]?.opts.jobId).toBe('expire:stuck-exp-terminal');
  });

  test('does not re-schedule expiration when expiresAt is null', async () => {
    const stuckFile: SelectFileRow = {
      id: 'stuck-noexp',
      objectKey: 'objects/stuck-noexp',
      expiresAt: null,
      uploadedAt: new Date(Date.now() - 20 * 60 * 1000)
    };
    const db: DbStubs = {
      selectSequence: [[], [], [stuckFile], [], []],
      updateSequence: [[{ id: 'stuck-noexp' }]]
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/stuck-noexp': true }
    };
    const queues: QueueStubs = {};
    const deps = makeMockDeps(db, storage, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedExpireAdds).toHaveLength(0);
  });

  test('deletes orphaned pending_upload record when storage object is missing', async () => {
    const stuckFile: SelectFileRow = {
      id: 'stuck-orphan',
      objectKey: 'objects/stuck-orphan',
      expiresAt: null,
      uploadedAt: new Date(Date.now() - 20 * 60 * 1000)
    };
    const db: DbStubs = {
      selectSequence: [[], [], [stuckFile], [], []],
      updateSequence: []
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/stuck-orphan': false }
    };
    const deps = makeMockDeps(db, storage);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedDeletes).toHaveLength(1);
  });

  test('skips stuck pending file when storage.exists throws (retry on next run)', async () => {
    const stuckFile: SelectFileRow = {
      id: 'stuck-storageerr',
      objectKey: 'objects/stuck-storageerr',
      expiresAt: null,
      uploadedAt: new Date(Date.now() - 20 * 60 * 1000)
    };
    const db: DbStubs = {
      selectSequence: [[], [], [stuckFile], [], []],
      updateSequence: []
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/stuck-storageerr': new Error('network timeout') }
    };
    const deps = makeMockDeps(db, storage);
    const warnSpy = spyOn(logger, 'warn');

    // Should not throw — just skip and continue
    await expect(makeHandleReconcile(deps)(makeJob())).resolves.toBeUndefined();
    expect(db.capturedDeletes).toHaveLength(0);
    expect(db.capturedAnomalies).toContainEqual(
      expect.objectContaining({
        type: 'reconciliation_scan_incomplete',
        fileId: 'stuck-storageerr',
        details: expect.objectContaining({
          phase: 'stuck_pending',
          operation: 'exists',
          reason: 'retry_next_run'
        })
      })
    );

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const firstCall = warnSpy.mock.calls.at(0);
    expect(firstCall?.[0]).toBe('Reconcile: storage check failed; leaving item for next run');
    expect(firstCall?.[1]).toMatchObject({
      event: 'reconciliation.anomaly_detected',
      anomalyType: 'storage_check_failed',
      phase: 'stuck_pending',
      operation: 'exists',
      objectKey: 'objects/stuck-storageerr',
      reason: 'retry_next_run',
      outcome: 'failure',
      entity: { type: 'file', id: 'stuck-storageerr' },
      error: 'network timeout'
    });
  });

  test('skips stuck pending when concurrent update changes status (0 rows returned)', async () => {
    const stuckFile: SelectFileRow = {
      id: 'stuck-race',
      objectKey: 'objects/stuck-race',
      expiresAt: null,
      uploadedAt: new Date(Date.now() - 20 * 60 * 1000)
    };
    const db: DbStubs = {
      selectSequence: [[], [], [stuckFile], [], []],
      updateSequence: [[]] // 0 rows
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/stuck-race': true }
    };
    const queues: QueueStubs = {};
    const deps = makeMockDeps(db, storage, queues);

    await makeHandleReconcile(deps)(makeJob());

    // Race: promotion update touched 0 rows → no expire job scheduled
    expect(queues.capturedExpireAdds).toHaveLength(0);
  });
});

// ── Pass D: Missing storage objects ─────────────────────────────────────────

describe('reconcile handler — Pass C: missing storage objects', () => {
  test('persists a missing-object cursor when the scan fills its batch', async () => {
    const activeFiles: SelectFileRow[] = Array.from({ length: 50 }, (_, idx) => ({
      id: `active-batch-${idx}`,
      objectKey: `objects/active-batch-${idx}`,
      uploadedAt: new Date(Date.parse('2026-03-01T00:00:00.000Z') + idx * 1_000),
      cursorTimestamp: new Date(Date.parse('2026-03-01T00:00:00.000Z') + idx * 1_000)
    }));
    const db: DbStubs = {
      selectSequence: [[], [], [], activeFiles, []]
    };
    const cursor: CursorStubs = {
      initialMissingObjectCursor: '2026-02-28T23:59:00.000Z|active-batch-prev'
    };
    const deps = makeMockDeps(db, {}, {}, cursor);

    await makeHandleReconcile(deps)(makeJob());

    expect(cursor.capturedPersistedMissingObjectCursors).toEqual([
      '2026-03-01T00:00:49.000Z|active-batch-49'
    ]);
  });

  test('marks active file as missing when storage object is absent', async () => {
    const activeFile: SelectFileRow = {
      id: 'active-missing',
      objectKey: 'objects/gone'
    };
    const db: DbStubs = {
      selectSequence: [[], [], [], [activeFile], []],
      updateSequence: [[{ id: 'active-missing' }]],
      anomalyFindFirstReturn: null
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/gone': false }
    };
    const deps = makeMockDeps(db, storage);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toHaveLength(1);
    expect(db.capturedAnomalies?.[0]?.type).toBe('missing_object');
    expect(db.capturedAnomalies?.[0]?.fileId).toBe('active-missing');
  });

  test('does not mark file as missing when object exists in storage', async () => {
    const activeFile: SelectFileRow = {
      id: 'active-present',
      objectKey: 'objects/present'
    };
    const db: DbStubs = {
      selectSequence: [[], [], [], [activeFile], []],
      updateSequence: []
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/present': true }
    };
    const deps = makeMockDeps(db, storage);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toHaveLength(0);
  });

  test('does not insert duplicate missing_object anomaly when one already exists', async () => {
    const activeFile: SelectFileRow = {
      id: 'dup-missing',
      objectKey: 'objects/dup-missing'
    };
    const db: DbStubs = {
      selectSequence: [[], [], [], [activeFile], []],
      updateSequence: [[{ id: 'dup-missing' }]],
      anomalyFindFirstReturn: { id: 'existing-missing-anomaly' }
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/dup-missing': false }
    };
    const deps = makeMockDeps(db, storage);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toHaveLength(0);
  });

  test('skips file when storage.exists throws (retry on next reconcile run)', async () => {
    const activeFile: SelectFileRow = {
      id: 'missing-storageerr',
      objectKey: 'objects/missing-storageerr'
    };
    const db: DbStubs = {
      selectSequence: [[], [], [], [activeFile], []],
      updateSequence: []
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/missing-storageerr': new Error('connection refused') }
    };
    const deps = makeMockDeps(db, storage);
    const warnSpy = spyOn(logger, 'warn');

    await expect(makeHandleReconcile(deps)(makeJob())).resolves.toBeUndefined();
    expect(db.capturedAnomalies).toContainEqual(
      expect.objectContaining({
        type: 'reconciliation_scan_incomplete',
        fileId: 'missing-storageerr',
        details: expect.objectContaining({
          phase: 'missing_object',
          operation: 'exists',
          reason: 'retry_next_run'
        })
      })
    );

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const firstCall = warnSpy.mock.calls.at(0);
    expect(firstCall?.[1]).toMatchObject({
      anomalyType: 'storage_check_failed',
      phase: 'missing_object',
      operation: 'exists',
      objectKey: 'objects/missing-storageerr',
      entity: { type: 'file', id: 'missing-storageerr' },
      error: 'connection refused'
    });
  });

  test('skips missing-object transition when concurrent update changes status (0 rows)', async () => {
    const activeFile: SelectFileRow = {
      id: 'missing-race',
      objectKey: 'objects/missing-race'
    };
    const db: DbStubs = {
      selectSequence: [[], [], [], [activeFile], []],
      updateSequence: [[]] // 0 rows returned
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/missing-race': false }
    };
    const deps = makeMockDeps(db, storage);

    await makeHandleReconcile(deps)(makeJob());

    // No anomaly if the update applied 0 rows (file already in terminal state)
    expect(db.capturedAnomalies).toHaveLength(0);
  });
});

// ── Pass E: Terminal cleanup repair ─────────────────────────────────────────

describe('reconcile handler — Pass E: terminal cleanup repair', () => {
  test('persists a terminal-cleanup cursor when the scan fills its batch', async () => {
    const terminalFiles: SelectFileRow[] = Array.from({ length: 100 }, (_, idx) => ({
      id: `terminal-batch-${idx}`,
      objectKey: `objects/terminal-batch-${idx}`,
      status: 'expired',
      consumedAt: null,
      uploadedAt: new Date(Date.parse('2026-03-02T00:00:00.000Z') + idx * 1_000),
      cursorTimestamp: new Date(Date.parse('2026-03-02T00:00:00.000Z') + idx * 1_000)
    }));
    const db: DbStubs = {
      selectSequence: [[], [], [], [], terminalFiles]
    };
    const storage: StorageStubs = {
      existsResults: Object.fromEntries(
        terminalFiles.map((file) => [file.objectKey, false] as const)
      )
    };
    const cursor: CursorStubs = {
      initialTerminalCleanupCursor: '2026-03-01T23:59:00.000Z|terminal-batch-prev'
    };
    const deps = makeMockDeps(db, storage, {}, cursor);

    await makeHandleReconcile(deps)(makeJob());

    expect(cursor.capturedPersistedTerminalCleanupCursors).toEqual([
      '2026-03-02T00:01:39.000Z|terminal-batch-99'
    ]);
  });

  test('enqueues cleanup for consumed file whose object still exists', async () => {
    const terminalFile: SelectFileRow = {
      id: 'consumed-terminal',
      objectKey: 'objects/consumed-terminal'
    };
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [terminalFile]]
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/consumed-terminal': true }
    };
    const queues: QueueStubs = {};
    const deps = makeMockDeps(db, storage, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedCleanupAdds).toHaveLength(1);
    expect(queues.capturedCleanupAdds?.[0]?.data.fileId).toBe('consumed-terminal');
    expect(queues.capturedCleanupAdds?.[0]?.opts.jobId).toBe('cleanup:consumed-terminal');
  });

  test('re-enqueues cleanup when existing cleanup job is terminal (failed)', async () => {
    const terminalFile: SelectFileRow = {
      id: 'terminal-failed-cleanup',
      objectKey: 'objects/terminal-failed-cleanup'
    };
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [terminalFile]]
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/terminal-failed-cleanup': true }
    };
    const queues: QueueStubs = {
      existingCleanupJobStates: { 'cleanup:terminal-failed-cleanup': 'failed' }
    };
    const deps = makeMockDeps(db, storage, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedRemovedCleanupJobIds).toEqual(['cleanup:terminal-failed-cleanup']);
    expect(queues.capturedCleanupAdds).toHaveLength(1);
    expect(queues.capturedCleanupAdds?.[0]?.opts.jobId).toBe('cleanup:terminal-failed-cleanup');
  });

  test('does not enqueue cleanup when a cleanup job already exists for the terminal file', async () => {
    const terminalFile: SelectFileRow = {
      id: 'terminal-existing-cleanup',
      objectKey: 'objects/terminal-existing-cleanup'
    };
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [terminalFile]]
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/terminal-existing-cleanup': true }
    };
    const queues: QueueStubs = {
      existingCleanupJobStates: { 'cleanup:terminal-existing-cleanup': 'delayed' }
    };
    const deps = makeMockDeps(db, storage, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedCleanupAdds).toHaveLength(0);
  });

  test('does not enqueue cleanup for recently consumed one-time file until the delivery window expires', async () => {
    const terminalFile: SelectFileRow = {
      id: 'consumed-recently',
      objectKey: 'objects/consumed-recently',
      status: 'consumed',
      consumedAt: new Date(Date.now() - (ONE_TIME_DOWNLOAD_CLEANUP_DELAY_MS - 5_000))
    };
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [terminalFile]]
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/consumed-recently': true }
    };
    const queues: QueueStubs = {};
    const deps = makeMockDeps(db, storage, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedCleanupAdds).toHaveLength(0);
  });

  test('skips cleanup repair when storage.exists throws and logs the failure', async () => {
    const terminalFile: SelectFileRow = {
      id: 'terminal-storageerr',
      objectKey: 'objects/terminal-storageerr'
    };
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [terminalFile]]
    };
    const storage: StorageStubs = {
      existsResults: { 'objects/terminal-storageerr': new Error('temporary rediscovery failure') }
    };
    const queues: QueueStubs = {};
    const deps = makeMockDeps(db, storage, queues);
    const warnSpy = spyOn(logger, 'warn');

    await expect(makeHandleReconcile(deps)(makeJob())).resolves.toBeUndefined();

    expect(queues.capturedCleanupAdds).toHaveLength(0);
    expect(db.capturedAnomalies).toContainEqual(
      expect.objectContaining({
        type: 'reconciliation_scan_incomplete',
        fileId: 'terminal-storageerr',
        details: expect.objectContaining({
          phase: 'terminal_cleanup',
          operation: 'exists',
          reason: 'retry_next_run'
        })
      })
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const firstCall = warnSpy.mock.calls.at(0);
    expect(firstCall?.[1]).toMatchObject({
      anomalyType: 'storage_check_failed',
      phase: 'terminal_cleanup',
      operation: 'exists',
      objectKey: 'objects/terminal-storageerr',
      entity: { type: 'file', id: 'terminal-storageerr' },
      error: 'temporary rediscovery failure'
    });
  });
});

// ── Pass F: Orphaned storage objects ────────────────────────────────────────

describe('reconcile handler — Pass F: orphaned storage objects', () => {
  test('records orphaned_object anomaly when storage object has no metadata record', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [], []],
      anomalyFindFirstReturn: null
    };
    const storage: StorageStubs = {
      listResult: {
        objects: [
          {
            key: 'objects/orphaned-1',
            size: 2048,
            lastModified: new Date('2026-03-12T10:00:00Z'),
            etag: 'etag-orphaned-1'
          }
        ]
      }
    };
    const deps = makeMockDeps(db, storage);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toHaveLength(1);
    expect(db.capturedAnomalies?.[0]?.type).toBe('orphaned_object');
    expect(db.capturedAnomalies?.[0]?.fileId).toBeNull();
  });

  test('does not insert duplicate orphaned_object anomaly when one already exists', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [], []],
      anomalyFindFirstReturn: { id: 'existing-orphaned-anomaly' }
    };
    const storage: StorageStubs = {
      listResult: {
        objects: [
          {
            key: 'objects/orphaned-existing',
            size: 512,
            lastModified: new Date('2026-03-12T10:00:00Z'),
            etag: 'etag-orphaned-existing'
          }
        ]
      }
    };
    const deps = makeMockDeps(db, storage);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toHaveLength(0);
  });

  test('paginates orphaned-object scans so later storage pages are still checked', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [], [], []],
      anomalyFindFirstReturn: null
    };
    const storage: StorageStubs = {
      listResults: [
        {
          objects: [
            {
              key: 'objects/orphaned-page-1',
              size: 128,
              lastModified: new Date('2026-03-12T10:00:00Z'),
              etag: 'etag-page-1'
            }
          ],
          isTruncated: true,
          nextStartAfter: 'objects/orphaned-page-1'
        },
        {
          objects: [
            {
              key: 'objects/orphaned-page-2',
              size: 256,
              lastModified: new Date('2026-03-12T10:05:00Z'),
              etag: 'etag-page-2'
            }
          ],
          isTruncated: false,
          nextStartAfter: null
        }
      ]
    };
    const deps = makeMockDeps(db, storage);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toHaveLength(2);
    expect(storage.capturedListOptions).toHaveLength(2);
    expect(storage.capturedListOptions?.[1]).toMatchObject({
      startAfter: 'objects/orphaned-page-1'
    });
  });

  test('resumes orphan scan from the persisted cursor and saves the next cursor for the following run', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [], []],
      anomalyFindFirstReturn: null
    };
    const storage: StorageStubs = {
      listResult: {
        objects: [
          {
            key: 'objects/orphaned-after-cursor',
            size: 64,
            lastModified: new Date('2026-03-12T10:10:00Z'),
            etag: 'etag-after-cursor'
          }
        ],
        isTruncated: true,
        nextStartAfter: 'objects/orphaned-after-cursor'
      }
    };
    const cursor: CursorStubs = { initialOrphanCursor: 'objects/known-prefix-tail' };
    const deps = makeMockDeps(db, storage, {}, cursor);

    await makeHandleReconcile(deps)(makeJob());

    expect(storage.capturedListOptions?.[0]).toMatchObject({
      startAfter: 'objects/known-prefix-tail'
    });
    expect(cursor.capturedPersistedOrphanCursors).toEqual(['objects/orphaned-after-cursor']);
  });

  test('clears the persisted orphan scan cursor when the scan reaches the end of the bucket', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [], []]
    };
    const storage: StorageStubs = {
      listResult: {
        objects: [],
        isTruncated: false,
        nextStartAfter: null
      }
    };
    const cursor: CursorStubs = { initialOrphanCursor: 'objects/previous-page-tail' };
    const deps = makeMockDeps(db, storage, {}, cursor);

    await makeHandleReconcile(deps)(makeJob());

    expect(cursor.capturedPersistedOrphanCursors).toEqual([null]);
  });

  test('continues when orphan scan cursor persistence fails after a successful scan', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [], []]
    };
    const storage: StorageStubs = {
      listResult: {
        objects: [],
        isTruncated: false,
        nextStartAfter: null
      }
    };
    const cursor: CursorStubs = { orphanPersistShouldThrow: true };
    const deps = makeMockDeps(db, storage, {}, cursor);
    const warnSpy = spyOn(logger, 'warn');

    await expect(makeHandleReconcile(deps)(makeJob())).resolves.toBeUndefined();

    expect(db.capturedAnomalies).toHaveLength(1);
    expect(db.capturedAnomalies?.[0]).toMatchObject({
      type: 'reconciliation_scan_incomplete',
      fileId: null
    });
    expect(warnSpy).toHaveBeenCalledWith(
      'Reconcile: failed to persist orphan scan cursor',
      expect.objectContaining({
        event: 'reconciliation.anomaly_detected',
        anomalyType: 'orphaned_object_scan_cursor_failed',
        reason: 'cursor_write_failed',
        entity: { type: 'queue', id: 'reconcile' }
      })
    );
  });

  test('logs a warning when the orphaned-object scan cannot list storage objects', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [], []]
    };
    const storage: StorageStubs = {
      listShouldThrow: true
    };
    const deps = makeMockDeps(db, storage);
    const warnSpy = spyOn(logger, 'warn');

    await expect(makeHandleReconcile(deps)(makeJob())).resolves.toBeUndefined();

    expect(db.capturedAnomalies).toContainEqual(
      expect.objectContaining({
        type: 'reconciliation_scan_incomplete',
        fileId: null,
        details: expect.objectContaining({
          phase: 'orphaned_object_scan',
          operation: 'list',
          reason: 'retry_next_run'
        })
      })
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const firstCall = warnSpy.mock.calls.at(0);
    expect(firstCall?.[1]).toMatchObject({
      event: 'reconciliation.anomaly_detected',
      anomalyType: 'storage_check_failed',
      phase: 'orphaned_object_scan',
      operation: 'list',
      entity: { type: 'queue', id: 'reconcile' },
      error: 'storage list failed'
    });
  });

  test('logs incomplete scan warning when storage page is truncated without nextStartAfter cursor', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], [], [], [], []]
    };
    const storage: StorageStubs = {
      listResult: {
        objects: [
          {
            key: 'objects/orphaned-no-cursor',
            size: 32,
            lastModified: new Date('2026-03-12T10:00:00Z'),
            etag: 'etag-no-cursor'
          }
        ],
        isTruncated: true,
        nextStartAfter: null
      }
    };
    const deps = makeMockDeps(db, storage);
    const warnSpy = spyOn(logger, 'warn');

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toHaveLength(2);
    expect(db.capturedAnomalies?.at(-1)).toMatchObject({
      type: 'reconciliation_scan_incomplete',
      fileId: null
    });
    expect(warnSpy).toHaveBeenCalledWith(
      'Reconcile: orphan scan truncated without continuation cursor',
      expect.objectContaining({
        event: 'reconciliation.anomaly_detected',
        anomalyType: 'orphaned_object_scan_incomplete',
        reason: 'missing_next_start_after',
        entity: { type: 'queue', id: 'reconcile' }
      })
    );
  });
});

// ── General behaviour ─────────────────────────────────────────────────────────

describe('reconcile handler — general behaviour', () => {
  test('resolves successfully when all reconcile passes find no work to do', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], []]
    };
    const deps = makeMockDeps(db, {});

    await expect(makeHandleReconcile(deps)(makeJob())).resolves.toBeUndefined();
  });

  test('uses supplied olderThan timestamp instead of current time', async () => {
    // Provide an olderThan well in the past so a file with expiresAt just
    // before that cutoff is NOT treated as overdue yet.
    const olderThan = new Date('2020-01-01T00:00:00Z');
    const fileExpiredBeforeCutoff: SelectFileRow = {
      id: 'historical',
      objectKey: 'objects/historical',
      expiresAt: new Date('2019-12-31T23:59:00Z') // 1 minute before cutoff
    };
    const db: DbStubs = {
      selectSequence: [[fileExpiredBeforeCutoff], [], []],
      updateSequence: [[{ id: 'historical' }]]
    };
    const queues: QueueStubs = {};
    const deps = makeMockDeps(db, {}, queues);

    await makeHandleReconcile(deps)(makeJob({ olderThan: olderThan.toISOString() }));

    // File was expired relative to the supplied olderThan → cleanup queued
    expect(queues.capturedCleanupAdds).toHaveLength(1);
  });

  test('falls back to now when olderThan payload is invalid', async () => {
    const staleFile: SelectFileRow = {
      id: 'invalid-older-than',
      objectKey: 'objects/invalid-older-than',
      expiresAt: new Date(Date.now() - 5_000)
    };
    const db: DbStubs = {
      selectSequence: [[staleFile], [], []],
      updateSequence: [[{ id: 'invalid-older-than' }]]
    };
    const queues: QueueStubs = {};
    const deps = makeMockDeps(db, {}, queues);
    const warnSpy = spyOn(logger, 'warn');

    await makeHandleReconcile(deps)(makeJob({ olderThan: 'not-a-date' }));

    expect(queues.capturedCleanupAdds).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledWith(
      'Reconcile: invalid olderThan payload, defaulting to now',
      expect.objectContaining({
        event: 'reconciliation.anomaly_detected',
        anomalyType: 'invalid_reconcile_payload',
        reason: 'invalid_older_than',
        olderThan: 'not-a-date',
        entity: { type: 'queue', id: 'reconcile' }
      })
    );
  });

  test('records backlog anomaly when existing lifecycle job state cannot be inspected', async () => {
    const futureFile: SelectFileRow = {
      id: 'future-unreadable-job',
      objectKey: 'objects/future-unreadable-job',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    };
    const db: DbStubs = {
      selectSequence: [[], [futureFile], [], [], []]
    };
    const queues: QueueStubs = {
      existingExpireJobStates: { 'expire:future-unreadable-job': 'waiting' },
      existingExpireJobStateErrors: {
        'expire:future-unreadable-job': new Error('state lookup failed')
      }
    };
    const deps = makeMockDeps(db, {}, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toHaveLength(1);
    expect(db.capturedAnomalies?.[0]).toMatchObject({
      type: 'reconciliation_scan_incomplete',
      fileId: 'future-unreadable-job'
    });
  });

  test('includes reconciliation duration telemetry in completion log', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], []]
    };
    const deps = makeMockDeps(db, {});
    const infoSpy = spyOn(logger, 'info');

    await makeHandleReconcile(deps)(makeJob());

    const completionCall = infoSpy.mock.calls.find(
      (call) => call[0] === 'Reconciliation completed'
    );

    expect(completionCall).toBeDefined();
    expect(completionCall?.[1]).toMatchObject({
      event: 'reconciliation.completed',
      outcome: 'success'
    });

    const loggedDuration = (completionCall?.[1] as { durationMs?: unknown })?.durationMs;
    expect(typeof loggedDuration).toBe('number');
    expect((loggedDuration as number) >= 0).toBe(true);
  });

  test('handles multiple stale files in Pass A independently', async () => {
    const now = new Date();
    const stale1: SelectFileRow = {
      id: 'multi-1',
      objectKey: 'objects/multi-1',
      expiresAt: new Date(now.getTime() - 5_000)
    };
    const stale2: SelectFileRow = {
      id: 'multi-2',
      objectKey: 'objects/multi-2',
      expiresAt: new Date(now.getTime() - 10_000)
    };
    const db: DbStubs = {
      selectSequence: [[stale1, stale2], [], []],
      updateSequence: [[{ id: 'multi-1' }], [{ id: 'multi-2' }]]
    };
    const queues: QueueStubs = {};
    const deps = makeMockDeps(db, {}, queues);

    await makeHandleReconcile(deps)(makeJob());

    expect(queues.capturedCleanupAdds).toHaveLength(2);
    const jobIds = queues.capturedCleanupAdds?.map((a) => a.opts.jobId);
    expect(jobIds).toContain('cleanup:multi-1');
    expect(jobIds).toContain('cleanup:multi-2');
  });

  test('detects duplicate pending lifecycle jobs for the same file', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], []]
    };
    const queues: QueueStubs = {
      expirePendingJobs: [
        { id: 'expire-1', data: { fileId: 'file-dup' } },
        { id: 'expire-2', data: { fileId: 'file-dup' } }
      ],
      cleanupPendingJobs: [{ id: 'cleanup-1', data: { fileId: 'file-other' } }]
    };
    const deps = makeMockDeps(db, {}, queues);
    const warnSpy = spyOn(logger, 'warn');

    await makeHandleReconcile(deps)(makeJob());

    expect(db.capturedAnomalies).toHaveLength(1);
    expect(db.capturedAnomalies?.[0]).toMatchObject({
      type: 'lifecycle_job_duplicate',
      fileId: 'file-dup'
    });
    expect(warnSpy).toHaveBeenCalledWith(
      'Reconcile: duplicate lifecycle jobs detected for same file',
      expect.objectContaining({
        event: 'reconciliation.anomaly_detected',
        anomalyType: 'lifecycle_job_duplicate',
        queue: 'expire-file',
        fileId: 'file-dup',
        duplicateCount: 2,
        jobIds: ['expire-1', 'expire-2']
      })
    );
  });

  test('continues reconciliation when lifecycle queue duplicate scan fails', async () => {
    const db: DbStubs = {
      selectSequence: [[], [], []]
    };
    const queues: QueueStubs = {
      cleanupGetJobsShouldThrow: true
    };
    const deps = makeMockDeps(db, {}, queues);
    const warnSpy = spyOn(logger, 'warn');

    await expect(makeHandleReconcile(deps)(makeJob())).resolves.toBeUndefined();

    expect(db.capturedAnomalies).toHaveLength(1);
    expect(db.capturedAnomalies?.[0]).toMatchObject({
      type: 'reconciliation_scan_incomplete',
      fileId: null
    });
    expect(warnSpy).toHaveBeenCalledWith(
      'Reconcile: failed to inspect lifecycle queue state',
      expect.objectContaining({
        event: 'reconciliation.anomaly_detected',
        anomalyType: 'lifecycle_queue_read_failed',
        queue: 'cleanup-file',
        operation: 'getJobs',
        reason: 'queue_read_failed',
        entity: { type: 'queue', id: 'cleanup-file' }
      })
    );
  });
});
