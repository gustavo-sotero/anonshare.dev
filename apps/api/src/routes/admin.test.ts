import { describe, expect, test } from 'bun:test';
import {
  adminAnomaliesResponseSchema,
  adminDownloadListResponseSchema,
  adminLifecycleStatsResponseSchema,
  adminOverviewResponseSchema,
  adminSessionResponseSchema
} from '@anonshare/contracts';
import type { createDb } from '@anonshare/infrastructure/db';
import { Hono } from 'hono';
import { type AdminRouterDeps, createAdminRouter } from './admin';

type SessionRecord = NonNullable<
  Awaited<ReturnType<NonNullable<AdminRouterDeps['findSessionById']>>>
>;

type QueueReader = ReturnType<NonNullable<AdminRouterDeps['getQueues']>>[number];

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    githubId: '123456',
    githubLogin: 'admin-user',
    expiresAt: new Date('2030-01-01T00:00:00Z'),
    revokedAt: null,
    ...overrides
  };
}

function makeQueue(
  name: QueueReader['name'],
  options: {
    counts?: Record<string, number>;
    waiting?: Array<{ timestamp?: number; delay?: number }>;
    delayed?: Array<{ timestamp?: number; delay?: number }>;
    jobs?: Array<{ attemptsMade?: number; processedOn?: number; finishedOn?: number }>;
  } = {}
): QueueReader {
  return {
    name,
    getJobCounts: async () => options.counts ?? {},
    getWaiting: async () => options.waiting ?? [],
    getDelayed: async () => options.delayed ?? [],
    getJobs: async () => options.jobs ?? []
  };
}

function buildApp(deps: AdminRouterDeps): Hono {
  const app = new Hono();
  app.route('/admin', createAdminRouter(deps));
  return app;
}

async function request(
  app: Hono,
  path: string,
  headers: Record<string, string> = {}
): Promise<Response> {
  return app.request(`http://localhost${path}`, {
    method: 'GET',
    headers
  });
}

describe('GET /admin/session', () => {
  test('returns unauthenticated when no session is present', async () => {
    const app = buildApp({
      findSessionById: async () => null,
      getAllowedGithubUserId: () => '123456',
      listAnomalies: async () => [],
      listOpenAnomalyCounts: async () => [],
      listReportStatusCounts: async () => [],
      listReportCountsByDay: async () => [],
      listAutoHiddenCountsByDay: async () => [],
      listResolvedReportCountsByDay: async () => [],
      listDismissedReportCountsByDay: async () => [],
      getQueues: () => [],
      now: () => new Date('2026-03-12T12:00:00Z')
    });

    const response = await request(app, '/admin/session');

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(adminSessionResponseSchema.safeParse(await response.json()).success).toBe(true);
  });

  test('returns authenticated session when header session id is valid and allowlisted', async () => {
    const sessionId = '00000000-0000-4000-8000-0000000000aa';
    const app = buildApp({
      findSessionById: async (sessionId) =>
        sessionId === '00000000-0000-4000-8000-0000000000aa'
          ? makeSession({ id: '00000000-0000-4000-8000-0000000000aa' })
          : null,
      getAllowedGithubUserId: () => '123456',
      listAnomalies: async () => [],
      listOpenAnomalyCounts: async () => [],
      listReportStatusCounts: async () => [],
      listReportCountsByDay: async () => [],
      listAutoHiddenCountsByDay: async () => [],
      listResolvedReportCountsByDay: async () => [],
      listDismissedReportCountsByDay: async () => [],
      getQueues: () => [],
      now: () => new Date('2026-03-12T12:00:00Z')
    });

    const response = await request(app, '/admin/session', { 'x-admin-session-id': sessionId });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(adminSessionResponseSchema.safeParse(body).success).toBe(true);
    expect(body.authenticated).toBe(true);
    expect(body.session.githubLogin).toBe('admin-user');
  });

  test('returns unauthenticated for expired session from cookie header', async () => {
    const app = buildApp({
      findSessionById: async () =>
        makeSession({
          id: 'expired-session',
          expiresAt: new Date('2026-03-12T11:00:00Z')
        }),
      getAllowedGithubUserId: () => '123456',
      listAnomalies: async () => [],
      listOpenAnomalyCounts: async () => [],
      listReportStatusCounts: async () => [],
      listReportCountsByDay: async () => [],
      listAutoHiddenCountsByDay: async () => [],
      listResolvedReportCountsByDay: async () => [],
      listDismissedReportCountsByDay: async () => [],
      getQueues: () => [],
      now: () => new Date('2026-03-12T12:00:00Z')
    });

    const response = await request(app, '/admin/session', {
      cookie: 'anonshare_admin_session=expired-session'
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ authenticated: false, session: null });
  });
});

describe('GET /admin/stats', () => {
  test('returns 401 when session is missing', async () => {
    const app = buildApp({
      findSessionById: async () => null,
      getAllowedGithubUserId: () => '123456',
      listAnomalies: async () => [],
      listOpenAnomalyCounts: async () => [],
      getQueues: () => [],
      now: () => new Date('2026-03-12T12:00:00Z')
    });

    const response = await request(app, '/admin/stats');
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.reason).toBe('session_required');
  });

  test('returns 403 when session github user is not allowlisted', async () => {
    const app = buildApp({
      findSessionById: async () => makeSession({ githubId: '999999' }),
      getAllowedGithubUserId: () => '123456',
      listAnomalies: async () => [],
      listOpenAnomalyCounts: async () => [],
      listReportStatusCounts: async () => [],
      getQueues: () => [],
      now: () => new Date('2026-03-12T12:00:00Z')
    });

    const response = await request(app, '/admin/stats', { 'x-admin-session-id': 'session-1' });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.reason).toBe('not_allowlisted');
  });

  test('returns lifecycle anomaly totals and queue health snapshots for valid session', async () => {
    const nowMs = Date.parse('2026-03-12T12:00:00Z');
    const app = buildApp({
      findSessionById: async () => makeSession({ id: 'session-1' }),
      getAllowedGithubUserId: () => '123456',
      listAnomalies: async () => [],
      listOpenAnomalyCounts: async () => [
        { type: 'missing_object', count: 2 },
        { type: 'orphaned_object', count: 1 }
      ],
      listReportStatusCounts: async () => [
        { status: 'pending', count: 4 },
        { status: 'resolved', count: 3 },
        { status: 'dismissed', count: 1 }
      ],
      listReportCountsByDay: async () => [
        { day: '2026-03-10', count: 2 },
        { day: '2026-03-11', count: 1 }
      ],
      listAutoHiddenCountsByDay: async () => [{ day: '2026-03-11', count: 1 }],
      listResolvedReportCountsByDay: async () => [{ day: '2026-03-11', count: 2 }],
      listDismissedReportCountsByDay: async () => [{ day: '2026-03-10', count: 1 }],
      listRateLimitBlockedCountsByDay: async () => [{ day: '2026-03-11', count: 3 }],
      getQueues: () => [
        makeQueue('expire-file', {
          counts: { waiting: 1, active: 0, delayed: 0, failed: 0, completed: 4 },
          waiting: [{ timestamp: nowMs - 5_000 }],
          jobs: [
            { attemptsMade: 0, processedOn: nowMs - 6_000, finishedOn: nowMs - 5_800 },
            { attemptsMade: 1, processedOn: nowMs - 4_000, finishedOn: nowMs - 3_200 }
          ]
        }),
        makeQueue('cleanup-file', {
          counts: { waiting: 0, active: 1, delayed: 0, failed: 0, completed: 9 },
          jobs: []
        }),
        makeQueue('reconcile', {
          counts: { waiting: 0, active: 0, delayed: 1, failed: 0, completed: 2 },
          delayed: [{ timestamp: nowMs - 20_000, delay: 10_000 }],
          jobs: [{ attemptsMade: 0, processedOn: nowMs - 30_000, finishedOn: nowMs - 25_000 }]
        })
      ],
      now: () => new Date(nowMs)
    });

    const response = await request(app, '/admin/stats', { 'x-admin-session-id': 'session-1' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(adminLifecycleStatsResponseSchema.safeParse(body).success).toBe(true);
    expect(body.openAnomaliesTotal).toBe(3);
    expect(body.openAnomaliesByType).toEqual({ missing_object: 2, orphaned_object: 1 });
    expect(body.reportTotals).toEqual({
      total: 8,
      byStatus: {
        pending: 4,
        resolved: 3,
        dismissed: 1
      }
    });
    expect(body.abuseMetrics.windowDays).toBe(14);
    expect(body.abuseMetrics.reportsByDay).toHaveLength(14);
    expect(body.abuseMetrics.autoHiddenByDay).toHaveLength(14);
    expect(body.abuseMetrics.resolvedReportsByDay).toHaveLength(14);
    expect(body.abuseMetrics.dismissedReportsByDay).toHaveLength(14);
    expect(body.abuseMetrics.rateLimitBlockedByDay).toHaveLength(14);
    expect(body.abuseMetrics.reportsByDay).toContainEqual({ day: '2026-03-10', count: 2 });
    expect(body.abuseMetrics.reportsByDay).toContainEqual({ day: '2026-03-11', count: 1 });
    expect(body.abuseMetrics.autoHiddenByDay).toContainEqual({ day: '2026-03-11', count: 1 });
    expect(body.abuseMetrics.resolvedReportsByDay).toContainEqual({ day: '2026-03-11', count: 2 });
    expect(body.abuseMetrics.dismissedReportsByDay).toContainEqual({ day: '2026-03-10', count: 1 });
    expect(body.abuseMetrics.rateLimitBlockedByDay).toContainEqual({ day: '2026-03-11', count: 3 });
    expect(body.queueHealth).toHaveLength(3);
    expect(body.queueHealth[0].status).toBe('healthy');
    expect(body.queueHealth[0].lastError).toBeNull();
    expect(body.queueHealth[0].lagMs).toBe(5_000);
    expect(body.queueHealth[0].processing).toEqual({
      sampledJobs: 2,
      retriedJobs: 1,
      retryRate: 0.5,
      avgAttemptsMade: 0.5,
      avgDurationMs: 500,
      p95DurationMs: 800
    });
    expect(body.queueHealth[1].processing).toEqual({
      sampledJobs: 0,
      retriedJobs: 0,
      retryRate: 0,
      avgAttemptsMade: 0,
      avgDurationMs: null,
      p95DurationMs: null
    });
    expect(body.queueHealth[2].lagMs).toBe(10_000);
  });

  test('returns degraded queue snapshot when queue telemetry read fails', async () => {
    const app = buildApp({
      findSessionById: async () => makeSession({ id: 'session-1' }),
      getAllowedGithubUserId: () => '123456',
      listAnomalies: async () => [],
      listOpenAnomalyCounts: async () => [],
      listReportStatusCounts: async () => [],
      listReportCountsByDay: async () => [],
      listAutoHiddenCountsByDay: async () => [],
      listResolvedReportCountsByDay: async () => [],
      listDismissedReportCountsByDay: async () => [],
      listRateLimitBlockedCountsByDay: async () => [],
      getQueues: () => [
        {
          name: 'expire-file',
          getJobCounts: async () => {
            throw new Error('redis unavailable');
          },
          getWaiting: async () => [],
          getDelayed: async () => [],
          getJobs: async () => []
        }
      ],
      now: () => new Date('2026-03-12T12:00:00Z')
    });

    const response = await request(app, '/admin/stats', { 'x-admin-session-id': 'session-1' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(adminLifecycleStatsResponseSchema.safeParse(body).success).toBe(true);
    expect(body.reportTotals).toEqual({
      total: 0,
      byStatus: {
        pending: 0,
        resolved: 0,
        dismissed: 0
      }
    });
    expect(body.abuseMetrics.windowDays).toBe(14);
    expect(body.abuseMetrics.reportsByDay).toHaveLength(14);
    expect(body.abuseMetrics.autoHiddenByDay).toHaveLength(14);
    expect(body.abuseMetrics.resolvedReportsByDay).toHaveLength(14);
    expect(body.abuseMetrics.dismissedReportsByDay).toHaveLength(14);
    expect(body.abuseMetrics.rateLimitBlockedByDay).toHaveLength(14);
    expect(
      body.abuseMetrics.reportsByDay.every((entry: { count: number }) => entry.count === 0)
    ).toBe(true);
    expect(
      body.abuseMetrics.autoHiddenByDay.every((entry: { count: number }) => entry.count === 0)
    ).toBe(true);
    expect(
      body.abuseMetrics.resolvedReportsByDay.every((entry: { count: number }) => entry.count === 0)
    ).toBe(true);
    expect(
      body.abuseMetrics.dismissedReportsByDay.every((entry: { count: number }) => entry.count === 0)
    ).toBe(true);
    expect(
      body.abuseMetrics.rateLimitBlockedByDay.every((entry: { count: number }) => entry.count === 0)
    ).toBe(true);
    expect(body.queueHealth).toEqual([
      {
        queue: 'expire-file',
        status: 'degraded',
        lastError: 'redis unavailable',
        waiting: 0,
        active: 0,
        delayed: 0,
        failed: 0,
        completed: 0,
        lagMs: 0,
        processing: {
          sampledJobs: 0,
          retriedJobs: 0,
          retryRate: 0,
          avgAttemptsMade: 0,
          avgDurationMs: null,
          p95DurationMs: null
        }
      }
    ]);
  });
});

describe('GET /admin/anomalies', () => {
  test('returns unresolved anomalies with severity derived from details or type fallback', async () => {
    const app = buildApp({
      findSessionById: async () => makeSession({ id: 'session-1' }),
      getAllowedGithubUserId: () => '123456',
      listAnomalies: async () => [
        {
          id: '00000000-0000-4000-8000-000000000010',
          type: 'failed_cleanup',
          fileId: '00000000-0000-4000-8000-000000000099',
          details: { objectKey: 'objects/a' },
          detectedAt: new Date('2026-03-12T10:00:00Z'),
          resolvedAt: null,
          resolution: null
        },
        {
          id: '00000000-0000-4000-8000-000000000011',
          type: 'lifecycle_job_overdue',
          fileId: '00000000-0000-4000-8000-000000000100',
          details: { severity: 'low', overdueMs: 10_000 },
          detectedAt: new Date('2026-03-12T11:00:00Z'),
          resolvedAt: null,
          resolution: null
        }
      ],
      listOpenAnomalyCounts: async () => [],
      listReportStatusCounts: async () => [],
      listReportCountsByDay: async () => [],
      listAutoHiddenCountsByDay: async () => [],
      listResolvedReportCountsByDay: async () => [],
      listDismissedReportCountsByDay: async () => [],
      getQueues: () => [],
      now: () => new Date('2026-03-12T12:00:00Z')
    });

    const response = await request(app, '/admin/anomalies?limit=2', {
      'x-admin-session-id': 'session-1'
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(adminAnomaliesResponseSchema.safeParse(body).success).toBe(true);
    expect(body.anomalies).toHaveLength(2);
    expect(body.anomalies[0].severity).toBe('high');
    expect(body.anomalies[1].severity).toBe('low');
  });
});

// ── Admin DB mock helpers ─────────────────────────────────────────────────────

type AdminFileRow = {
  id: string;
  token: string;
  objectKey: string;
  sanitizedFilename: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  reportCount: number;
  allowPreview: boolean;
  oneTimeDownload: boolean;
  expiresAt: Date | null;
  uploadedAt: Date;
  activatedAt: Date | null;
  consumedAt: Date | null;
  deletedAt: Date | null;
};

type AdminReportRow = {
  id: string;
  fileId: string;
  reason: string;
  message: string | null;
  status: string;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  ipHash: string | null;
  createdAt: Date;
};

function makeAdminFile(overrides: Partial<AdminFileRow> = {}): AdminFileRow {
  return {
    id: 'file-uuid-admin-1',
    token: 'AdminToken12345678',
    objectKey: 'objects/admin-test',
    sanitizedFilename: 'admin-test.txt',
    mimeType: 'text/plain',
    sizeBytes: 2048,
    status: 'active',
    reportCount: 0,
    allowPreview: false,
    oneTimeDownload: false,
    expiresAt: null,
    uploadedAt: new Date('2026-01-15T10:00:00Z'),
    activatedAt: new Date('2026-01-15T10:00:01Z'),
    consumedAt: null,
    deletedAt: null,
    ...overrides
  };
}

function makeAdminReport(overrides: Partial<AdminReportRow> = {}): AdminReportRow {
  return {
    id: 'rpt-admin-uuid-1',
    fileId: 'file-uuid-admin-1',
    reason: 'spam',
    message: null,
    status: 'pending',
    resolvedBy: null,
    resolvedAt: null,
    ipHash: null,
    createdAt: new Date('2026-02-01T08:00:00Z'),
    ...overrides
  };
}

type AdminDbOpts = {
  fileLookup?: AdminFileRow | null;
  reportLookup?: AdminReportRow | null;
  /** Results returned in sequence for each db.select()...from()... chain call. */
  selectResults?: unknown[][];
  transactionShouldThrow?: boolean;
  updateShouldThrow?: boolean;
  capturedTxInserts?: unknown[];
  capturedTxUpdates?: unknown[];
  capturedUpdates?: unknown[];
};

function makeAdminDb(opts: AdminDbOpts = {}): ReturnType<typeof createDb> {
  let selectCallCount = 0;

  const makeSelectChain = (result: unknown[]) => {
    const makeOffsetLevel = (r: unknown[]) => Promise.resolve(r);
    const makeLimitLevel = (r: unknown[]) =>
      Object.assign(Promise.resolve(r), {
        offset: (_off: unknown) => makeOffsetLevel(r)
      });
    const makeOrderByLevel = (r: unknown[]) =>
      Object.assign(Promise.resolve(r), {
        limit: (_l: unknown) => makeLimitLevel(r)
      });
    const makeWhereLevel = (r: unknown[]) =>
      Object.assign(Promise.resolve(r), {
        orderBy: (_o: unknown) => makeOrderByLevel(r)
      });
    return {
      where: (_c: unknown) => makeWhereLevel(result),
      orderBy: (_o: unknown) => makeOrderByLevel(result)
    };
  };

  return {
    query: {
      files: {
        findFirst: async () => opts.fileLookup ?? null
      },
      reports: {
        findFirst: async () => opts.reportLookup ?? null
      }
    },
    select: (_cols?: unknown) => ({
      from: (_tbl: unknown) => {
        const idx = selectCallCount++;
        const result = opts.selectResults?.[idx] ?? [];
        return makeSelectChain(result);
      }
    }),
    update: (_tbl: unknown) => ({
      set: (vals: unknown) => ({
        where: (_cond: unknown) => {
          if (opts.capturedUpdates) opts.capturedUpdates.push(vals);
          if (opts.updateShouldThrow) return Promise.reject(new Error('Update failed'));
          return Promise.resolve();
        }
      })
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      if (opts.transactionShouldThrow) throw new Error('Transaction failed');
      const tx = {
        update: (_tbl: unknown) => ({
          set: (vals: unknown) => ({
            where: (_cond: unknown) => {
              if (opts.capturedTxUpdates) opts.capturedTxUpdates.push(vals);
              return Promise.resolve();
            }
          })
        }),
        insert: (_tbl: unknown) => ({
          values: (vals: unknown) => {
            if (opts.capturedTxInserts) opts.capturedTxInserts.push(vals);
            return Promise.resolve();
          }
        })
      };
      return fn(tx);
    }
  } as unknown as ReturnType<typeof createDb>;
}

const FIXED_ADMIN_NOW = new Date('2026-03-15T10:00:00Z');

function makeAuthDeps(
  db: ReturnType<typeof createDb>,
  extra: Partial<AdminRouterDeps> = {}
): AdminRouterDeps {
  return {
    findSessionById: async () => makeSession({ id: 'session-1' }),
    getAllowedGithubUserId: () => '123456',
    listAnomalies: async () => [],
    listOpenAnomalyCounts: async () => [],
    listReportStatusCounts: async () => [],
    listReportCountsByDay: async () => [],
    listAutoHiddenCountsByDay: async () => [],
    listResolvedReportCountsByDay: async () => [],
    listDismissedReportCountsByDay: async () => [],
    getQueues: () => [],
    now: () => FIXED_ADMIN_NOW,
    getDb: () => db,
    enqueueCleanupFile: async () => {},
    ...extra
  };
}

async function jsonPost(
  app: Hono,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return app.request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-session-id': 'session-1',
      ...headers
    },
    body: JSON.stringify(body)
  });
}

// ── GET /admin/files ──────────────────────────────────────────────────────────

describe('GET /admin/files', () => {
  test('returns 401 when no session is present', async () => {
    const db = makeAdminDb({ selectResults: [[], [{ total: 0 }]] });
    const app = buildApp({
      ...makeAuthDeps(db),
      findSessionById: async () => null
    });

    const response = await app.request('http://localhost/admin/files', { method: 'GET' });
    expect(response.status).toBe(401);
  });

  test('returns paginated file list', async () => {
    const file = makeAdminFile();
    const db = makeAdminDb({ selectResults: [[file], [{ total: 1 }]] });
    const app = buildApp(makeAuthDeps(db));

    const response = await request(app, '/admin/files', { 'x-admin-session-id': 'session-1' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.files).toHaveLength(1);
    expect(body.files[0].id).toBe(file.id);
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
  });

  test('returns empty list when no files exist', async () => {
    const db = makeAdminDb({ selectResults: [[], [{ total: 0 }]] });
    const app = buildApp(makeAuthDeps(db));

    const response = await request(app, '/admin/files', { 'x-admin-session-id': 'session-1' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.files).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  test('accepts optional status filter', async () => {
    const db = makeAdminDb({ selectResults: [[], [{ total: 0 }]] });
    const app = buildApp(makeAuthDeps(db));

    const response = await request(app, '/admin/files?status=hidden', {
      'x-admin-session-id': 'session-1'
    });
    expect(response.status).toBe(200);
  });

  test('accepts policy, upload window, and minimum report count filters', async () => {
    const db = makeAdminDb({ selectResults: [[], [{ total: 0 }]] });
    const app = buildApp(makeAuthDeps(db));

    const response = await request(
      app,
      '/admin/files?policy=one_time&uploadedWithinDays=7&minReportCount=2',
      {
        'x-admin-session-id': 'session-1'
      }
    );

    expect(response.status).toBe(200);
  });

  test('accepts sortBy=sizeBytes_desc', async () => {
    const db = makeAdminDb({ selectResults: [[], [{ total: 0 }]] });
    const app = buildApp(makeAuthDeps(db));

    const response = await request(app, '/admin/files?sortBy=sizeBytes_desc', {
      'x-admin-session-id': 'session-1'
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ files: [], total: 0, page: 1 });
  });

  test('accepts sortBy=reportCount_desc', async () => {
    const db = makeAdminDb({ selectResults: [[], [{ total: 0 }]] });
    const app = buildApp(makeAuthDeps(db));

    const response = await request(app, '/admin/files?sortBy=reportCount_desc', {
      'x-admin-session-id': 'session-1'
    });
    expect(response.status).toBe(200);
  });

  test('returns 400 for invalid sortBy value', async () => {
    const db = makeAdminDb();
    const app = buildApp(makeAuthDeps(db));

    const response = await request(app, '/admin/files?sortBy=badSort', {
      'x-admin-session-id': 'session-1'
    });
    expect(response.status).toBe(400);
  });

  test('returns 400 for invalid status value', async () => {
    const db = makeAdminDb();
    const app = buildApp(makeAuthDeps(db));

    const response = await request(app, '/admin/files?status=not_a_status', {
      'x-admin-session-id': 'session-1'
    });
    expect(response.status).toBe(400);
  });
});

// ── GET /admin/files/:id ──────────────────────────────────────────────────────

describe('GET /admin/files/:id', () => {
  test('returns 404 for unknown file id', async () => {
    const db = makeAdminDb({ fileLookup: null });
    const app = buildApp(makeAuthDeps(db));

    const response = await request(app, '/admin/files/unknown-id', {
      'x-admin-session-id': 'session-1'
    });
    expect(response.status).toBe(404);
  });

  test('returns file with reports and moderation history', async () => {
    const file = makeAdminFile();
    const report = makeAdminReport();
    const recentDownloadEvent = {
      id: '00000000-0000-4000-8000-000000000201',
      fileId: file.id,
      eventType: 'completed',
      createdAt: new Date('2026-03-15T09:45:00Z'),
      ipHash: 'abc123'
    };
    const db = makeAdminDb({
      fileLookup: file,
      selectResults: [[report], [], [recentDownloadEvent], [{ total: 4 }]]
    });
    const app = buildApp(
      makeAuthDeps(db, {
        headStorageObject: async () => ({
          contentLength: file.sizeBytes,
          contentType: file.mimeType
        })
      })
    );

    const response = await request(app, `/admin/files/${file.id}`, {
      'x-admin-session-id': 'session-1'
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.file.id).toBe(file.id);
    expect(body.file.reports).toHaveLength(1);
    expect(body.file.reports[0].id).toBe(report.id);
    expect(body.file.reports[0].urgency).toBe('medium');
    expect(body.file.moderationHistory).toHaveLength(0);
    expect(body.file.storageObject).toEqual({
      objectKey: file.objectKey,
      status: 'present',
      contentLength: file.sizeBytes,
      contentType: file.mimeType,
      checkedAt: FIXED_ADMIN_NOW.toISOString(),
      error: null
    });
    expect(body.file.downloadActivity.total).toBe(4);
    expect(body.file.downloadActivity.recent).toEqual([
      {
        id: recentDownloadEvent.id,
        fileId: file.id,
        eventType: 'completed',
        createdAt: recentDownloadEvent.createdAt.toISOString(),
        ipHash: 'abc123'
      }
    ]);
  });

  test('returns degraded storage detail without failing the file inspection payload', async () => {
    const file = makeAdminFile();
    const db = makeAdminDb({
      fileLookup: file,
      selectResults: [[], [], [], [{ total: 0 }]]
    });
    const app = buildApp(
      makeAuthDeps(db, {
        headStorageObject: async () => {
          throw new Error('storage unavailable');
        }
      })
    );

    const response = await request(app, `/admin/files/${file.id}`, {
      'x-admin-session-id': 'session-1'
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.file.storageObject).toEqual({
      objectKey: file.objectKey,
      status: 'unknown',
      contentLength: null,
      contentType: null,
      checkedAt: FIXED_ADMIN_NOW.toISOString(),
      error: 'storage unavailable'
    });
    expect(body.file.downloadActivity).toEqual({ total: 0, recent: [] });
  });
});

// ── POST /admin/files/:id/moderate ───────────────────────────────────────────

describe('POST /admin/files/:id/moderate', () => {
  test('returns 401 when not authenticated', async () => {
    const db = makeAdminDb();
    const app = buildApp({
      ...makeAuthDeps(db),
      findSessionById: async () => null
    });

    const response = await jsonPost(app, '/admin/files/file-1/moderate', { action: 'hide' }, {});
    expect(response.status).toBe(401);
  });

  test('reuses the validated session for moderation audit fields', async () => {
    let lookupCount = 0;
    const capturedTxInserts: unknown[] = [];
    const file = makeAdminFile({ status: 'active' });
    const db = makeAdminDb({ fileLookup: file, capturedTxInserts });
    const app = buildApp(
      makeAuthDeps(db, {
        findSessionById: async () => {
          lookupCount += 1;

          if (lookupCount === 1) {
            return makeSession({ id: 'session-1', githubLogin: 'audit-admin' });
          }

          throw new Error('session lookup should not be repeated');
        }
      })
    );

    const response = await jsonPost(
      app,
      `/admin/files/${file.id}/moderate`,
      { action: 'hide', reason: 'Manual hide' },
      { 'x-admin-session-id': 'session-1' }
    );

    expect(response.status).toBe(200);
    expect(lookupCount).toBe(1);
    expect(capturedTxInserts).toHaveLength(1);
    expect(capturedTxInserts[0]).toMatchObject({
      actorGithubId: '123456',
      actorGithubLogin: 'audit-admin'
    });
  });

  test('hides an active file successfully', async () => {
    const capturedTxInserts: unknown[] = [];
    const file = makeAdminFile({ status: 'active' });
    const db = makeAdminDb({ fileLookup: file, capturedTxInserts });
    const app = buildApp(makeAuthDeps(db));

    const response = await jsonPost(
      app,
      `/admin/files/${file.id}/moderate`,
      { action: 'hide', reason: 'Manual hide' },
      { 'x-admin-session-id': 'session-1' }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.previousStatus).toBe('active');
    expect(body.data.nextStatus).toBe('hidden');
    // A moderation action row should have been inserted
    expect(capturedTxInserts).toHaveLength(1);
    const action = capturedTxInserts[0] as { action: string; nextStatus: string };
    expect(action.action).toBe('hide');
    expect(action.nextStatus).toBe('hidden');
  });

  test('returns 409 when trying to hide an already-hidden file', async () => {
    const file = makeAdminFile({ status: 'hidden' });
    const db = makeAdminDb({ fileLookup: file });
    const app = buildApp(makeAuthDeps(db));

    const response = await jsonPost(
      app,
      `/admin/files/${file.id}/moderate`,
      { action: 'hide' },
      { 'x-admin-session-id': 'session-1' }
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('conflict');
  });

  test('returns 409 when trying to hide a non-public lifecycle state', async () => {
    const file = makeAdminFile({
      status: 'consumed',
      consumedAt: new Date('2026-03-15T09:00:00Z')
    });
    const db = makeAdminDb({ fileLookup: file });
    const app = buildApp(makeAuthDeps(db));

    const response = await jsonPost(
      app,
      `/admin/files/${file.id}/moderate`,
      { action: 'hide' },
      { 'x-admin-session-id': 'session-1' }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('conflict');
    expect(body.error.message).toBe('Only active or expiring files can be hidden.');
  });

  test('restores a hidden file', async () => {
    const file = makeAdminFile({ status: 'hidden' });
    const db = makeAdminDb({ fileLookup: file });
    const app = buildApp(makeAuthDeps(db));

    const response = await jsonPost(
      app,
      `/admin/files/${file.id}/moderate`,
      { action: 'restore' },
      { 'x-admin-session-id': 'session-1' }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.previousStatus).toBe('hidden');
    expect(body.data.nextStatus).toBe('active');
  });

  test('restores a hidden file back to expiring when it was hidden from expiring state', async () => {
    const file = makeAdminFile({
      status: 'hidden',
      expiresAt: new Date('2026-03-16T12:00:00Z')
    });
    const db = makeAdminDb({
      fileLookup: file,
      selectResults: [[{ previousStatus: 'expiring' }]]
    });
    const app = buildApp(makeAuthDeps(db));

    const response = await jsonPost(
      app,
      `/admin/files/${file.id}/moderate`,
      { action: 'restore' },
      { 'x-admin-session-id': 'session-1' }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.previousStatus).toBe('hidden');
    expect(body.data.nextStatus).toBe('expiring');
  });

  test('restores a hidden file back to consumed when it was hidden from consumed state', async () => {
    const file = makeAdminFile({
      status: 'hidden',
      oneTimeDownload: true,
      consumedAt: new Date('2026-03-15T08:00:00Z')
    });
    const db = makeAdminDb({
      fileLookup: file,
      selectResults: [[{ previousStatus: 'consumed' }]]
    });
    const app = buildApp(makeAuthDeps(db));

    const response = await jsonPost(
      app,
      `/admin/files/${file.id}/moderate`,
      { action: 'restore' },
      { 'x-admin-session-id': 'session-1' }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.previousStatus).toBe('hidden');
    expect(body.data.nextStatus).toBe('consumed');
  });

  test('restores a hidden file to expired when the expiration deadline already passed', async () => {
    const cleanupEnqueued: Array<{ fileId: string; objectKey: string }> = [];
    const file = makeAdminFile({
      status: 'hidden',
      expiresAt: new Date('2026-03-15T09:00:00Z')
    });
    const db = makeAdminDb({
      fileLookup: file,
      selectResults: [[{ previousStatus: 'expiring' }]]
    });
    const app = buildApp(
      makeAuthDeps(db, {
        enqueueCleanupFile: async (fileId, objectKey) => {
          cleanupEnqueued.push({ fileId, objectKey });
        }
      })
    );

    const response = await jsonPost(
      app,
      `/admin/files/${file.id}/moderate`,
      { action: 'restore' },
      { 'x-admin-session-id': 'session-1' }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.previousStatus).toBe('hidden');
    expect(body.data.nextStatus).toBe('expired');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(cleanupEnqueued).toEqual([{ fileId: file.id, objectKey: file.objectKey }]);
  });

  test('returns 409 when restoring a non-hidden file', async () => {
    const file = makeAdminFile({ status: 'active' });
    const db = makeAdminDb({ fileLookup: file });
    const app = buildApp(makeAuthDeps(db));

    const response = await jsonPost(
      app,
      `/admin/files/${file.id}/moderate`,
      { action: 'restore' },
      { 'x-admin-session-id': 'session-1' }
    );
    expect(response.status).toBe(409);
  });

  test('deletes a file and enqueues cleanup', async () => {
    const cleanupEnqueued: Array<{ fileId: string; objectKey: string }> = [];
    const file = makeAdminFile({ status: 'active' });
    const db = makeAdminDb({ fileLookup: file });
    const app = buildApp(
      makeAuthDeps(db, {
        enqueueCleanupFile: async (fileId, objectKey) => {
          cleanupEnqueued.push({ fileId, objectKey });
        }
      })
    );

    const response = await jsonPost(
      app,
      `/admin/files/${file.id}/moderate`,
      { action: 'delete' },
      { 'x-admin-session-id': 'session-1' }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.nextStatus).toBe('deleted');
    // Give the fire-and-forget cleanup a tick to run
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(cleanupEnqueued).toHaveLength(1);
    expect(cleanupEnqueued[0]?.fileId).toBe(file.id);
    expect(cleanupEnqueued[0]?.objectKey).toBe(file.objectKey);
  });

  test('returns 409 when deleting an already-deleted file', async () => {
    const file = makeAdminFile({ status: 'deleted' });
    const db = makeAdminDb({ fileLookup: file });
    const app = buildApp(makeAuthDeps(db));

    const response = await jsonPost(
      app,
      `/admin/files/${file.id}/moderate`,
      { action: 'delete' },
      { 'x-admin-session-id': 'session-1' }
    );
    expect(response.status).toBe(409);
  });

  test('returns 404 for unknown file', async () => {
    const db = makeAdminDb({ fileLookup: null });
    const app = buildApp(makeAuthDeps(db));

    const response = await jsonPost(
      app,
      '/admin/files/nonexistent/moderate',
      { action: 'hide' },
      { 'x-admin-session-id': 'session-1' }
    );
    expect(response.status).toBe(404);
  });

  test('returns 400 for invalid moderation action', async () => {
    const db = makeAdminDb();
    const app = buildApp(makeAuthDeps(db));

    const response = await jsonPost(
      app,
      '/admin/files/file-1/moderate',
      { action: 'invalid_action' },
      { 'x-admin-session-id': 'session-1' }
    );
    expect(response.status).toBe(400);
  });
});

// ── GET /admin/reports ────────────────────────────────────────────────────────

describe('GET /admin/reports', () => {
  test('returns 401 when not authenticated', async () => {
    const db = makeAdminDb();
    const app = buildApp({
      ...makeAuthDeps(db),
      findSessionById: async () => null
    });

    const response = await app.request('http://localhost/admin/reports', { method: 'GET' });
    expect(response.status).toBe(401);
  });

  test('returns paginated report list', async () => {
    const report = makeAdminReport();
    const db = makeAdminDb({ selectResults: [[report], [{ total: 1 }]] });
    const app = buildApp(makeAuthDeps(db));

    const response = await request(app, '/admin/reports', { 'x-admin-session-id': 'session-1' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reports).toHaveLength(1);
    expect(body.reports[0].id).toBe(report.id);
    expect(body.reports[0].urgency).toBe('medium');
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
  });

  test('accepts status and fileId filters', async () => {
    const db = makeAdminDb({ selectResults: [[], [{ total: 0 }]] });
    const app = buildApp(makeAuthDeps(db));

    const response = await request(
      app,
      '/admin/reports?status=pending&fileId=00000000-0000-4000-8000-000000000001',
      {
        'x-admin-session-id': 'session-1'
      }
    );
    expect(response.status).toBe(200);
  });

  test('accepts reason and urgency filters', async () => {
    const db = makeAdminDb({ selectResults: [[], [{ total: 0 }]] });
    const app = buildApp(makeAuthDeps(db));

    const response = await request(app, '/admin/reports?reason=malware&urgency=high', {
      'x-admin-session-id': 'session-1'
    });

    expect(response.status).toBe(200);
  });

  test('returns 400 for invalid status filter', async () => {
    const db = makeAdminDb();
    const app = buildApp(makeAuthDeps(db));

    const response = await request(app, '/admin/reports?status=bad_status', {
      'x-admin-session-id': 'session-1'
    });
    expect(response.status).toBe(400);
  });
});

// ── POST /admin/reports/:id/resolve ──────────────────────────────────────────

describe('POST /admin/reports/:id/resolve', () => {
  test('resolves a pending report', async () => {
    const report = makeAdminReport({ id: 'rpt-1', status: 'pending' });
    const db = makeAdminDb({ reportLookup: report });
    const app = buildApp(makeAuthDeps(db));

    const response = await jsonPost(
      app,
      '/admin/reports/rpt-1/resolve',
      { action: 'resolved' },
      { 'x-admin-session-id': 'session-1' }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.reportId).toBe('rpt-1');
    expect(body.data.status).toBe('resolved');
    expect(body.data.resolvedAt).toBe(FIXED_ADMIN_NOW.toISOString());
  });

  test('reuses the validated session for report resolution audit fields', async () => {
    let lookupCount = 0;
    const capturedUpdates: unknown[] = [];
    const report = makeAdminReport({ id: 'rpt-audit', status: 'pending' });
    const db = makeAdminDb({ reportLookup: report, capturedUpdates });
    const app = buildApp(
      makeAuthDeps(db, {
        findSessionById: async () => {
          lookupCount += 1;

          if (lookupCount === 1) {
            return makeSession({ id: 'session-1', githubLogin: 'resolver-admin' });
          }

          throw new Error('session lookup should not be repeated');
        }
      })
    );

    const response = await jsonPost(
      app,
      '/admin/reports/rpt-audit/resolve',
      { action: 'resolved' },
      { 'x-admin-session-id': 'session-1' }
    );

    expect(response.status).toBe(200);
    expect(lookupCount).toBe(1);
    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0]).toMatchObject({
      status: 'resolved',
      resolvedBy: 'resolver-admin',
      resolvedAt: FIXED_ADMIN_NOW
    });
  });

  test('dismisses a pending report', async () => {
    const report = makeAdminReport({ id: 'rpt-2', status: 'pending' });
    const db = makeAdminDb({ reportLookup: report });
    const app = buildApp(makeAuthDeps(db));

    const response = await jsonPost(
      app,
      '/admin/reports/rpt-2/resolve',
      { action: 'dismissed' },
      { 'x-admin-session-id': 'session-1' }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe('dismissed');
  });

  test('returns 404 for unknown report', async () => {
    const db = makeAdminDb({ reportLookup: null });
    const app = buildApp(makeAuthDeps(db));

    const response = await jsonPost(
      app,
      '/admin/reports/nonexistent/resolve',
      { action: 'resolved' },
      { 'x-admin-session-id': 'session-1' }
    );
    expect(response.status).toBe(404);
  });

  test('returns 409 when report is already resolved', async () => {
    const report = makeAdminReport({ id: 'rpt-3', status: 'resolved' });
    const db = makeAdminDb({ reportLookup: report });
    const app = buildApp(makeAuthDeps(db));

    const response = await jsonPost(
      app,
      '/admin/reports/rpt-3/resolve',
      { action: 'resolved' },
      { 'x-admin-session-id': 'session-1' }
    );
    expect(response.status).toBe(409);
  });

  test('returns 400 for invalid action', async () => {
    const db = makeAdminDb();
    const app = buildApp(makeAuthDeps(db));

    const response = await jsonPost(
      app,
      '/admin/reports/rpt-1/resolve',
      { action: 'invalid' },
      { 'x-admin-session-id': 'session-1' }
    );
    expect(response.status).toBe(400);
  });

  test('returns 401 when not authenticated', async () => {
    const db = makeAdminDb();
    const app = buildApp({
      ...makeAuthDeps(db),
      findSessionById: async () => null
    });

    const response = await jsonPost(
      app,
      '/admin/reports/rpt-1/resolve',
      { action: 'resolved' },
      {}
    );
    expect(response.status).toBe(401);
  });
});

// ── GET /admin/overview ───────────────────────────────────────────────────────

describe('GET /admin/overview', () => {
  test('returns 401 when no session is present', async () => {
    const db = makeAdminDb();
    const app = buildApp({ ...makeAuthDeps(db), findSessionById: async () => null });

    const response = await app.request('http://localhost/admin/overview', { method: 'GET' });
    expect(response.status).toBe(401);
  });

  test('returns file counts by status, total storage, and download totals', async () => {
    const db = makeAdminDb();
    const app = buildApp({
      ...makeAuthDeps(db),
      listFileStatusCounts: async () => [
        { status: 'active', count: 5, totalSizeBytes: 10240 },
        { status: 'expired', count: 2, totalSizeBytes: 2048 },
        { status: 'deleted', count: 1, totalSizeBytes: 512 }
      ],
      getDownloadCounts: async () => ({ totalDownloads: 20 })
    });

    const response = await request(app, '/admin/overview', {
      'x-admin-session-id': 'session-1'
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(adminOverviewResponseSchema.safeParse(body).success).toBe(true);
    expect(body.totalFiles).toBe(8);
    expect(body.byStatus.active).toBe(5);
    expect(body.byStatus.expired).toBe(2);
    expect(body.byStatus.deleted).toBe(1);
    expect(body.totalStorageBytes).toBe(12800);
    expect(body.totalDownloads).toBe(20);
  });

  test('returns zero counts when no files exist', async () => {
    const db = makeAdminDb();
    const app = buildApp({
      ...makeAuthDeps(db),
      listFileStatusCounts: async () => [],
      getDownloadCounts: async () => ({ totalDownloads: 0 })
    });

    const response = await request(app, '/admin/overview', {
      'x-admin-session-id': 'session-1'
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.totalFiles).toBe(0);
    expect(body.totalStorageBytes).toBe(0);
    expect(body.totalDownloads).toBe(0);
  });
});

// ── GET /admin/downloads ──────────────────────────────────────────────────────

describe('GET /admin/downloads', () => {
  test('returns 401 when not authenticated', async () => {
    const db = makeAdminDb();
    const app = buildApp({ ...makeAuthDeps(db), findSessionById: async () => null });

    const response = await app.request('http://localhost/admin/downloads', { method: 'GET' });
    expect(response.status).toBe(401);
  });

  test('returns paginated download events for valid session', async () => {
    const downloadEvent = {
      id: '00000000-0000-4000-8000-000000000055',
      fileId: '00000000-0000-4000-8000-000000000099',
      eventType: 'completed',
      createdAt: new Date('2026-03-15T10:00:00Z'),
      ipHash: null
    };
    const db = makeAdminDb({ selectResults: [[downloadEvent], [{ total: 1 }]] });
    const app = buildApp(makeAuthDeps(db));

    const response = await request(app, '/admin/downloads', {
      'x-admin-session-id': 'session-1'
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(adminDownloadListResponseSchema.safeParse(body).success).toBe(true);
    expect(body.downloads).toHaveLength(1);
    expect(body.downloads[0].id).toBe(downloadEvent.id);
    expect(body.downloads[0].eventType).toBe('completed');
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
  });

  test('returns empty list when no download events exist', async () => {
    const db = makeAdminDb({ selectResults: [[], [{ total: 0 }]] });
    const app = buildApp(makeAuthDeps(db));

    const response = await request(app, '/admin/downloads', {
      'x-admin-session-id': 'session-1'
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.downloads).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  test('accepts optional fileId filter', async () => {
    const db = makeAdminDb({ selectResults: [[], [{ total: 0 }]] });
    const app = buildApp(makeAuthDeps(db));

    const response = await request(
      app,
      '/admin/downloads?fileId=00000000-0000-4000-8000-000000000099',
      { 'x-admin-session-id': 'session-1' }
    );
    expect(response.status).toBe(200);
  });
});
