import { describe, expect, test } from 'bun:test';
import {
  adminAnomaliesResponseSchema,
  adminDownloadListResponseSchema,
  adminLifecycleStatsResponseSchema,
  adminOverviewResponseSchema
} from '@anonshare/contracts';
import {
  buildApp,
  makeAdminDb,
  makeAuthDeps,
  makeQueue,
  makeSession,
  request
} from './test-helpers';

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
    expect(body.abuseMetrics.dismissedReportsByDay).toContainEqual({
      day: '2026-03-10',
      count: 1
    });
    expect(body.abuseMetrics.rateLimitBlockedByDay).toContainEqual({
      day: '2026-03-11',
      count: 3
    });
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

  test('returns zero-filled rate-limit series when the optional blocked-counts dep is absent', async () => {
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
      // listRateLimitBlockedCountsByDay intentionally omitted
      getQueues: () => [],
      now: () => new Date('2026-03-12T12:00:00Z')
    });

    const response = await request(app, '/admin/stats', { 'x-admin-session-id': 'session-1' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(adminLifecycleStatsResponseSchema.safeParse(body).success).toBe(true);
    expect(body.abuseMetrics.rateLimitBlockedByDay).toHaveLength(14);
    expect(
      body.abuseMetrics.rateLimitBlockedByDay.every((entry: { count: number }) => entry.count === 0)
    ).toBe(true);
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

  test('normalizes stringified anomaly details before returning the response', async () => {
    const app = buildApp({
      findSessionById: async () => makeSession({ id: 'session-1' }),
      getAllowedGithubUserId: () => '123456',
      listAnomalies: async () => [
        {
          id: '00000000-0000-4000-8000-000000000012',
          type: 'lifecycle_job_overdue',
          fileId: null,
          details: JSON.stringify({
            severity: 'low',
            queue: 'reconcile',
            overdueMs: 10_000
          }),
          detectedAt: new Date('2026-03-12T12:30:00Z'),
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
      now: () => new Date('2026-03-12T13:00:00Z')
    });

    const response = await request(app, '/admin/anomalies?limit=1', {
      'x-admin-session-id': 'session-1'
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(adminAnomaliesResponseSchema.safeParse(body).success).toBe(true);
    expect(body.anomalies).toEqual([
      {
        id: '00000000-0000-4000-8000-000000000012',
        type: 'lifecycle_job_overdue',
        severity: 'low',
        fileId: null,
        details: {
          severity: 'low',
          queue: 'reconcile',
          overdueMs: 10_000
        },
        detectedAt: '2026-03-12T12:30:00.000Z',
        resolvedAt: null,
        resolution: null
      }
    ]);
  });
});

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
