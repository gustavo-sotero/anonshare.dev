import { describe, expect, test } from 'bun:test';
import {
  adminAnomaliesResponseSchema,
  adminLifecycleStatsResponseSchema,
  adminSessionResponseSchema
} from '@anonshare/contracts';
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
      getQueues: () => [],
      now: () => new Date('2026-03-12T12:00:00Z')
    });

    const response = await request(app, '/admin/session');

    expect(response.status).toBe(200);
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
    expect(adminLifecycleStatsResponseSchema.safeParse(body).success).toBe(true);
    expect(body.openAnomaliesTotal).toBe(3);
    expect(body.openAnomaliesByType).toEqual({ missing_object: 2, orphaned_object: 1 });
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
