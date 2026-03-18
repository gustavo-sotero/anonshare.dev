import { describe, expect, test } from 'bun:test';
import {
  accessDeniedResponseSchema,
  adminAnomaliesResponseSchema,
  adminFileDetailResponseSchema,
  adminFileListQuerySchema,
  adminLifecycleStatsResponseSchema,
  adminLoginCallbackSchema,
  adminLoginStartResponseSchema,
  adminReportListQuerySchema,
  adminSessionResponseSchema,
  moderationActionSchema,
  operationalAnomalySummarySchema,
  queueHealthSnapshotSchema,
  resolveReportSchema
} from './admin';

describe('moderationActionSchema', () => {
  test('accepts supported moderation actions', () => {
    expect(moderationActionSchema.safeParse({ action: 'hide' }).success).toBe(true);
    expect(moderationActionSchema.safeParse({ action: 'restore' }).success).toBe(true);
    expect(moderationActionSchema.safeParse({ action: 'delete' }).success).toBe(true);
  });

  test('rejects unsupported moderation action', () => {
    const result = moderationActionSchema.safeParse({ action: 'archive' });
    expect(result.success).toBe(false);
  });

  test('rejects reason longer than 500 chars', () => {
    const result = moderationActionSchema.safeParse({ action: 'hide', reason: 'a'.repeat(501) });
    expect(result.success).toBe(false);
  });
});

describe('resolveReportSchema', () => {
  test('accepts supported resolve actions', () => {
    expect(resolveReportSchema.safeParse({ action: 'resolved' }).success).toBe(true);
    expect(resolveReportSchema.safeParse({ action: 'dismissed' }).success).toBe(true);
  });

  test('rejects unsupported resolve action', () => {
    const result = resolveReportSchema.safeParse({ action: 'reopen' });
    expect(result.success).toBe(false);
  });
});

describe('adminLoginCallbackSchema', () => {
  test('accepts callback payload with code and state', () => {
    const result = adminLoginCallbackSchema.safeParse({
      code: 'oauth-code',
      state: 'csrf-state'
    });
    expect(result.success).toBe(true);
  });

  test('rejects empty code/state', () => {
    const result = adminLoginCallbackSchema.safeParse({ code: '', state: '' });
    expect(result.success).toBe(false);
  });
});

describe('adminLoginStartResponseSchema', () => {
  test('accepts OAuth authorization URL and state', () => {
    const result = adminLoginStartResponseSchema.safeParse({
      authorizationUrl: 'https://github.com/login/oauth/authorize?client_id=abc',
      state: 'csrf-token'
    });

    expect(result.success).toBe(true);
  });

  test('rejects invalid URL', () => {
    const result = adminLoginStartResponseSchema.safeParse({
      authorizationUrl: 'not-a-url',
      state: 'csrf-token'
    });

    expect(result.success).toBe(false);
  });
});

describe('adminSessionResponseSchema', () => {
  test('accepts authenticated response with session', () => {
    const result = adminSessionResponseSchema.safeParse({
      authenticated: true,
      session: {
        id: crypto.randomUUID(),
        githubId: '123456',
        githubLogin: 'admin-user',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString()
      }
    });

    expect(result.success).toBe(true);
  });

  test('accepts unauthenticated response without session', () => {
    const result = adminSessionResponseSchema.safeParse({
      authenticated: false,
      session: null
    });

    expect(result.success).toBe(true);
  });

  test('rejects authenticated response without session', () => {
    const result = adminSessionResponseSchema.safeParse({
      authenticated: true,
      session: null
    });

    expect(result.success).toBe(false);
  });

  test('rejects authenticated response with non-numeric githubId', () => {
    const result = adminSessionResponseSchema.safeParse({
      authenticated: true,
      session: {
        id: crypto.randomUUID(),
        githubId: 'admin-user',
        githubLogin: 'admin-user',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString()
      }
    });

    expect(result.success).toBe(false);
  });

  test('rejects authenticated response with githubId longer than 64 chars', () => {
    const result = adminSessionResponseSchema.safeParse({
      authenticated: true,
      session: {
        id: crypto.randomUUID(),
        githubId: '1'.repeat(65),
        githubLogin: 'admin-user',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString()
      }
    });

    expect(result.success).toBe(false);
  });

  test('rejects authenticated response with githubLogin longer than 255 chars', () => {
    const result = adminSessionResponseSchema.safeParse({
      authenticated: true,
      session: {
        id: crypto.randomUUID(),
        githubId: '123456',
        githubLogin: 'a'.repeat(256),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString()
      }
    });

    expect(result.success).toBe(false);
  });
});

describe('accessDeniedResponseSchema', () => {
  test('accepts known denial reasons', () => {
    expect(
      accessDeniedResponseSchema.safeParse({
        reason: 'session_required',
        message: 'Authentication required.'
      }).success
    ).toBe(true);

    expect(
      accessDeniedResponseSchema.safeParse({
        reason: 'session_expired',
        message: 'Session expired.'
      }).success
    ).toBe(true);

    expect(
      accessDeniedResponseSchema.safeParse({
        reason: 'not_allowlisted',
        message: 'Access denied.'
      }).success
    ).toBe(true);
  });

  test('rejects unsupported denial reason', () => {
    const result = accessDeniedResponseSchema.safeParse({
      reason: 'ip_blocked',
      message: 'Denied.'
    });

    expect(result.success).toBe(false);
  });
});

describe('operational anomaly admin schemas', () => {
  test('accepts an operational anomaly summary with severity and context', () => {
    const result = operationalAnomalySummarySchema.safeParse({
      id: crypto.randomUUID(),
      type: 'lifecycle_job_duplicate',
      severity: 'medium',
      fileId: crypto.randomUUID(),
      details: {
        queue: 'expire-file',
        duplicateCount: 2,
        source: 'reconcile'
      },
      detectedAt: new Date().toISOString(),
      resolvedAt: null,
      resolution: null
    });

    expect(result.success).toBe(true);
  });

  test('rejects an anomaly summary with unsupported severity', () => {
    const result = operationalAnomalySummarySchema.safeParse({
      id: crypto.randomUUID(),
      type: 'missing_object',
      severity: 'critical',
      fileId: crypto.randomUUID(),
      details: {},
      detectedAt: new Date().toISOString(),
      resolvedAt: null,
      resolution: null
    });

    expect(result.success).toBe(false);
  });

  test('accepts queue health snapshots for lifecycle queues', () => {
    const result = queueHealthSnapshotSchema.safeParse({
      queue: 'cleanup-file',
      status: 'healthy',
      lastError: null,
      waiting: 0,
      active: 1,
      delayed: 2,
      failed: 0,
      completed: 10,
      lagMs: 250,
      processing: {
        sampledJobs: 25,
        retriedJobs: 4,
        retryRate: 0.16,
        avgAttemptsMade: 0.2,
        avgDurationMs: 45,
        p95DurationMs: 90
      }
    });

    expect(result.success).toBe(true);
  });

  test('accepts admin lifecycle stats response', () => {
    const result = adminLifecycleStatsResponseSchema.safeParse({
      openAnomaliesTotal: 2,
      openAnomaliesByType: {
        missing_object: 1,
        lifecycle_job_overdue: 1
      },
      reportTotals: {
        total: 3,
        byStatus: {
          pending: 2,
          resolved: 1,
          dismissed: 0
        }
      },
      abuseMetrics: {
        windowDays: 14,
        reportsByDay: [
          { day: '2026-03-01', count: 1 },
          { day: '2026-03-02', count: 0 }
        ],
        autoHiddenByDay: [
          { day: '2026-03-01', count: 0 },
          { day: '2026-03-02', count: 1 }
        ],
        resolvedReportsByDay: [
          { day: '2026-03-01', count: 0 },
          { day: '2026-03-02', count: 1 }
        ],
        dismissedReportsByDay: [
          { day: '2026-03-01', count: 1 },
          { day: '2026-03-02', count: 0 }
        ],
        rateLimitBlockedByDay: [
          { day: '2026-03-01', count: 0 },
          { day: '2026-03-02', count: 2 }
        ]
      },
      queueHealth: [
        {
          queue: 'expire-file',
          status: 'healthy',
          lastError: null,
          waiting: 0,
          active: 0,
          delayed: 3,
          failed: 0,
          completed: 11,
          lagMs: 0,
          processing: {
            sampledJobs: 11,
            retriedJobs: 0,
            retryRate: 0,
            avgAttemptsMade: 0,
            avgDurationMs: 12,
            p95DurationMs: 20
          }
        }
      ]
    });

    expect(result.success).toBe(true);
  });

  test('accepts admin anomalies response', () => {
    const result = adminAnomaliesResponseSchema.safeParse({
      anomalies: [
        {
          id: crypto.randomUUID(),
          type: 'failed_cleanup',
          severity: 'high',
          fileId: crypto.randomUUID(),
          details: { objectKey: 'objects/example' },
          detectedAt: new Date().toISOString(),
          resolvedAt: null,
          resolution: null
        }
      ]
    });

    expect(result.success).toBe(true);
  });

  test('accepts admin file detail with storage state and recent download activity', () => {
    const result = adminFileDetailResponseSchema.safeParse({
      file: {
        id: crypto.randomUUID(),
        token: 'AdminToken12345678',
        sanitizedFilename: 'evidence.txt',
        mimeType: 'text/plain',
        sizeBytes: 2048,
        status: 'active',
        reportCount: 2,
        allowPreview: false,
        oneTimeDownload: false,
        expiresAt: null,
        uploadedAt: new Date('2026-03-18T12:00:00Z').toISOString(),
        activatedAt: new Date('2026-03-18T12:00:01Z').toISOString(),
        consumedAt: null,
        deletedAt: null,
        storageObject: {
          objectKey: 'objects/evidence',
          status: 'present',
          contentLength: 2048,
          contentType: 'text/plain',
          checkedAt: new Date('2026-03-18T12:30:00Z').toISOString(),
          error: null
        },
        downloadActivity: {
          total: 3,
          recent: [
            {
              id: crypto.randomUUID(),
              fileId: crypto.randomUUID(),
              eventType: 'completed',
              createdAt: new Date('2026-03-18T12:10:00Z').toISOString(),
              ipHash: 'abc123'
            }
          ]
        },
        reports: [],
        moderationHistory: []
      }
    });

    expect(result.success).toBe(true);
  });

  test('accepts admin file list filters for policy, upload date, and report volume', () => {
    const result = adminFileListQuerySchema.safeParse({
      status: 'hidden',
      policy: 'one_time',
      sortBy: 'reportCount_desc',
      uploadedWithinDays: '7',
      minReportCount: '3',
      page: '2',
      pageSize: '20'
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      policy: 'one_time',
      sortBy: 'reportCount_desc',
      uploadedWithinDays: 7,
      minReportCount: 3,
      page: 2,
      pageSize: 20
    });
  });

  test('accepts admin report list filters for reason and urgency', () => {
    const result = adminReportListQuerySchema.safeParse({
      status: 'pending',
      reason: 'malware',
      urgency: 'high',
      page: '1',
      pageSize: '10'
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      status: 'pending',
      reason: 'malware',
      urgency: 'high',
      page: 1,
      pageSize: 10
    });
  });
});
