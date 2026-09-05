import { describe, expect, test } from 'bun:test';
import { API_ERROR_CODES } from '@anonshare/contracts';
import type { createDb } from '@anonshare/infrastructure/db';
import type { Redis } from '@anonshare/infrastructure/redis';
import { Hono } from 'hono';
import { createReportRouter, type ReportRouterDeps } from './report';

// ── Test-double helpers ───────────────────────────────────────────────────────

const VALID_TOKEN = 'Abc123defghijkl012';
const FIXED_NOW = new Date('2026-03-12T12:00:00Z');

type FileRow = {
  id: string;
  token: string;
  objectKey: string;
  status: string;
  reportCount: number;
  sanitizedFilename: string;
  mimeType: string;
  sizeBytes: number;
  allowPreview: boolean;
  oneTimeDownload: boolean;
  expiresAt: Date | null;
  uploadedAt: Date;
  consumedAt: Date | null;
};

function makeFile(overrides: Partial<FileRow> = {}): FileRow {
  return {
    id: 'file-uuid-1',
    token: VALID_TOKEN,
    objectKey: 'objects/test-uuid',
    status: 'active',
    reportCount: 0,
    sanitizedFilename: 'test.txt',
    mimeType: 'text/plain',
    sizeBytes: 1024,
    allowPreview: false,
    oneTimeDownload: false,
    expiresAt: null,
    uploadedAt: new Date('2026-01-01T00:00:00Z'),
    consumedAt: null,
    ...overrides
  };
}

type DbOpts = {
  file?: FileRow | null;
  threshold?: number | null; // null = not found in settings; undefined = default 3
  thresholdShouldThrow?: boolean;
  transactionShouldThrow?: boolean;
  autoHideInsertShouldThrow?: boolean;
  autoHideRaceLost?: boolean; // simulate concurrent hide winning the race
  reportId?: string;
  newReportCount?: number;
  capturedInsertValues?: unknown[];
  capturedAutoHideValues?: unknown[];
};

function makeDb(opts: DbOpts = {}): ReturnType<typeof createDb> {
  let txInsertCallCount = 0;
  let txUpdateCallCount = 0;

  return {
    query: {
      files: {
        findFirst: async () => opts.file ?? null
      },
      systemSettings: {
        findFirst: async () => {
          if (opts.thresholdShouldThrow) throw new Error('Settings query failed');
          if (opts.threshold === null) return null;
          return {
            key: 'report_auto_hide_threshold',
            value: String(opts.threshold ?? 3)
          };
        }
      }
    },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      if (opts.transactionShouldThrow) throw new Error('Transaction failed');
      const reportId = opts.reportId ?? 'rpt-uuid-1';
      const newCount = opts.newReportCount ?? 1;
      const currentStatus = opts.file?.status ?? 'active';
      const promoted = opts.autoHideRaceLost ? [] : [{ id: opts.file?.id ?? 'file-uuid-1' }];

      const tx = {
        insert: (_tbl: unknown) => ({
          values: (vals: unknown) => {
            txInsertCallCount += 1;

            if (txInsertCallCount === 1) {
              if (opts.capturedInsertValues) opts.capturedInsertValues.push(vals);
              return {
                returning: async () => [{ id: reportId }]
              };
            }

            if (opts.autoHideInsertShouldThrow) {
              return Promise.reject(new Error('Auto-hide insert failed'));
            }

            if (opts.capturedAutoHideValues) opts.capturedAutoHideValues.push(vals);
            return Promise.resolve();
          }
        }),
        update: (_tbl: unknown) => ({
          set: (_values: unknown) => ({
            where: (_c: unknown) => ({
              returning: async () => {
                txUpdateCallCount += 1;
                if (txUpdateCallCount === 1) {
                  return [{ reportCount: newCount, status: currentStatus }];
                }
                return promoted;
              }
            })
          })
        })
      };

      return fn(tx);
    }
  } as unknown as ReturnType<typeof createDb>;
}

function makeRedis(
  opts: {
    globalCount?: number; // count after incr for global rl key (> limit means blocked)
    perFileCount?: number; // count after incr for per-file rl key
    shouldThrow?: boolean;
  } = {}
): Redis {
  const { globalCount = 1, perFileCount = 1, shouldThrow = false } = opts;
  let incrCallCount = 0;

  return {
    incr: async (_key: string) => {
      if (shouldThrow) {
        throw new Error('redis unavailable');
      }
      incrCallCount++;
      return incrCallCount === 1 ? globalCount : perFileCount;
    },
    expire: async () => 1,
    ttl: async () => 3599
  } as unknown as Redis;
}

function makeDeps(db: ReturnType<typeof createDb>, redis?: Redis): ReportRouterDeps {
  const deps: ReportRouterDeps = {
    getDb: () => db,
    now: () => FIXED_NOW
  };
  if (redis) deps.getRedis = () => redis;
  return deps;
}

/** Build deps without rate limiting (no Redis dep injected). */
function makeDepsNoRl(db: ReturnType<typeof createDb>): ReportRouterDeps {
  return {
    getDb: () => db,
    now: () => FIXED_NOW
  };
}

function buildApp(deps: ReportRouterDeps): Hono {
  const app = new Hono();
  app.route('/report', createReportRouter(deps));
  return app;
}

async function post(
  app: Hono,
  token: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return app.request(`http://localhost/report/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

// ── Token validation ──────────────────────────────────────────────────────────

describe('POST /report/:token — token validation', () => {
  test('returns 404 with no-store cache header for malformed token', async () => {
    const app = buildApp(makeDeps(makeDb()));
    const res = await post(app, 'bad!', { reason: 'spam' });

    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.NOT_FOUND);
  });

  test('returns 404 for token that is too short', async () => {
    const app = buildApp(makeDeps(makeDb()));
    const res = await post(app, 'abc', { reason: 'spam' });

    expect(res.status).toBe(404);
  });
});

// ── Rate limiting ─────────────────────────────────────────────────────────────

describe('POST /report/:token — rate limiting', () => {
  test('returns 429 when global per-IP rate limit is exceeded', async () => {
    const db = makeDb({ file: makeFile() });
    const redis = makeRedis({ globalCount: 11 }); // over limit of 10
    const app = buildApp(makeDeps(db, redis));

    const res = await post(app, VALID_TOKEN, { reason: 'spam' }, { 'x-forwarded-for': '1.2.3.4' });

    expect(res.status).toBe(429);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.RATE_LIMITED);
  });

  test('uses the configured report rate limit loader when provided', async () => {
    const db = makeDb({ file: makeFile() });
    const redis = makeRedis({ globalCount: 6 });
    const app = buildApp({
      ...makeDeps(db, redis),
      loadReportRateLimit: async () => 5
    });

    const res = await post(app, VALID_TOKEN, { reason: 'spam' }, { 'x-forwarded-for': '1.2.3.4' });

    expect(res.status).toBe(429);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.RATE_LIMITED);
  });

  test('returns 429 when per-file per-IP rate limit is exceeded', async () => {
    const db = makeDb({ file: makeFile() });
    // global passes (count 1), per-file exceeds (4 > limit of 3)
    const redis = makeRedis({ globalCount: 1, perFileCount: 4 });
    const app = buildApp(makeDeps(db, redis));

    const res = await post(app, VALID_TOKEN, { reason: 'spam' }, { 'x-forwarded-for': '1.2.3.4' });

    expect(res.status).toBe(429);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.RATE_LIMITED);
  });

  test('bypasses rate limiting when no IP header is present', async () => {
    // No Redis dep injected, no IP headers - should reach body validation
    const db = makeDb({ file: null });
    const app = buildApp(makeDepsNoRl(db));

    // No IP header → rate limit skipped → reaches file lookup → 404 (file not found)
    const res = await post(app, VALID_TOKEN, { reason: 'spam' });
    expect(res.status).toBe(404);
  });

  test('continues report submission when rate limiter backend is unavailable', async () => {
    const db = makeDb({ file: makeFile(), reportId: 'rpt-uuid-degraded', newReportCount: 1 });
    const redis = makeRedis({ shouldThrow: true });
    const app = buildApp(makeDeps(db, redis));

    const res = await post(app, VALID_TOKEN, { reason: 'spam' }, { 'x-forwarded-for': '1.2.3.4' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { id: string } };
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe('rpt-uuid-degraded');
  });
});

// ── Body validation ───────────────────────────────────────────────────────────

describe('POST /report/:token — body validation', () => {
  test('returns 400 for missing reason field', async () => {
    const db = makeDb({ file: makeFile() });
    const app = buildApp(makeDepsNoRl(db));

    const res = await post(app, VALID_TOKEN, { message: 'no reason' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
  });

  test('returns 400 for invalid reason value', async () => {
    const db = makeDb({ file: makeFile() });
    const app = buildApp(makeDepsNoRl(db));

    const res = await post(app, VALID_TOKEN, { reason: 'not_a_valid_reason' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
  });

  test('returns 400 when body is not valid JSON', async () => {
    const db = makeDb({ file: makeFile() });
    const app = buildApp(makeDepsNoRl(db));

    const res = await app.request(`http://localhost/report/${VALID_TOKEN}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json'
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
  });
});

// ── File lookup ───────────────────────────────────────────────────────────────

describe('POST /report/:token — file status gating', () => {
  test('returns 404 when file is not found', async () => {
    const db = makeDb({ file: null });
    const app = buildApp(makeDepsNoRl(db));

    const res = await post(app, VALID_TOKEN, { reason: 'spam' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.error.code).toBe(API_ERROR_CODES.NOT_FOUND);
  });

  test('returns 404 for pending_upload status', async () => {
    const db = makeDb({ file: makeFile({ status: 'pending_upload' }) });
    const app = buildApp(makeDepsNoRl(db));

    const res = await post(app, VALID_TOKEN, { reason: 'spam' });
    expect(res.status).toBe(404);
  });

  test('returns 404 for missing status', async () => {
    const db = makeDb({ file: makeFile({ status: 'missing' }) });
    const app = buildApp(makeDepsNoRl(db));

    const res = await post(app, VALID_TOKEN, { reason: 'spam' });
    expect(res.status).toBe(404);
  });

  test('returns 410 FILE_HIDDEN for hidden file', async () => {
    const db = makeDb({ file: makeFile({ status: 'hidden' }) });
    const app = buildApp(makeDepsNoRl(db));

    const res = await post(app, VALID_TOKEN, { reason: 'spam' });
    expect(res.status).toBe(410);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.error.code).toBe(API_ERROR_CODES.FILE_HIDDEN);
  });

  test('returns 410 FILE_DELETED for deleted file', async () => {
    const db = makeDb({ file: makeFile({ status: 'deleted' }) });
    const app = buildApp(makeDepsNoRl(db));

    const res = await post(app, VALID_TOKEN, { reason: 'spam' });
    expect(res.status).toBe(410);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.error.code).toBe(API_ERROR_CODES.FILE_DELETED);
  });
});

// ── Happy path ────────────────────────────────────────────────────────────────

describe('POST /report/:token — happy path', () => {
  test('returns 200 with report id and createdAt for active file', async () => {
    const db = makeDb({
      file: makeFile({ status: 'active', reportCount: 0 }),
      reportId: 'rpt-uuid-1',
      newReportCount: 1,
      threshold: 3 // won't auto-hide because 1 < 3
    });
    const app = buildApp(makeDepsNoRl(db));

    const res = await post(app, VALID_TOKEN, { reason: 'spam', message: 'bad content' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { id: string; createdAt: string } };
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe('rpt-uuid-1');
    expect(body.data.createdAt).toBe(FIXED_NOW.toISOString());
  });

  test('accepts report for expiring file', async () => {
    const db = makeDb({
      file: makeFile({ status: 'expiring' }),
      reportId: 'rpt-uuid-2',
      newReportCount: 1,
      threshold: 5
    });
    const app = buildApp(makeDepsNoRl(db));

    const res = await post(app, VALID_TOKEN, { reason: 'illegal_content' });
    expect(res.status).toBe(200);
  });

  test('accepts report for expired file', async () => {
    const db = makeDb({
      file: makeFile({ status: 'expired' }),
      reportId: 'rpt-uuid-3',
      newReportCount: 1,
      threshold: 3
    });
    const app = buildApp(makeDepsNoRl(db));

    const res = await post(app, VALID_TOKEN, { reason: 'malware' });
    expect(res.status).toBe(200);
  });

  test('accepts report for consumed one-time file', async () => {
    const db = makeDb({
      file: makeFile({ status: 'consumed' }),
      reportId: 'rpt-uuid-4',
      newReportCount: 1,
      threshold: 3
    });
    const app = buildApp(makeDepsNoRl(db));

    const res = await post(app, VALID_TOKEN, { reason: 'copyright_violation' });
    expect(res.status).toBe(200);
  });

  test('stores ipHash in report when IP header is present', async () => {
    const capturedInsertValues: unknown[] = [];
    const db = makeDb({
      file: makeFile({ status: 'active' }),
      reportId: 'rpt-uuid-5',
      newReportCount: 1,
      threshold: 5,
      capturedInsertValues
    });
    const app = buildApp({
      ...makeDeps(db),
      getRedis: () => makeRedis({ globalCount: 1, perFileCount: 1 })
    });

    await post(app, VALID_TOKEN, { reason: 'spam' }, { 'x-forwarded-for': '10.0.0.1' });

    // The insert values captured in the transaction should include a non-null ipHash
    const insertedReport = capturedInsertValues[0] as { ipHash: string | null };
    expect(insertedReport).toBeDefined();
    expect(typeof insertedReport?.ipHash).toBe('string');
    expect(insertedReport.ipHash?.length ?? 0).toBe(32); // 32 hex chars from SHA-256 slice
  });
});

// ── Auto-hide ─────────────────────────────────────────────────────────────────

describe('POST /report/:token — auto-hide', () => {
  test('auto-hides active file when report count meets threshold', async () => {
    const capturedAutoHideValues: unknown[] = [];
    const db = makeDb({
      file: makeFile({ status: 'active' }),
      reportId: 'rpt-uuid-10',
      newReportCount: 3, // equals threshold of 3 → triggers auto-hide
      threshold: 3,
      capturedAutoHideValues
    });
    const app = buildApp(makeDepsNoRl(db));

    const res = await post(app, VALID_TOKEN, { reason: 'spam' });
    expect(res.status).toBe(200);

    // Auto-hide moderation action should have been inserted
    expect(capturedAutoHideValues.length).toBeGreaterThan(0);
    const action = capturedAutoHideValues[0] as {
      action: string;
      nextStatus: string;
      actorGithubId: string;
    };
    expect(action.action).toBe('hide');
    expect(action.nextStatus).toBe('hidden');
    expect(action.actorGithubId).toBe('0');
  });

  test('auto-hides expiring file when count exceeds threshold', async () => {
    const capturedAutoHideValues: unknown[] = [];
    const db = makeDb({
      file: makeFile({ status: 'expiring' }),
      reportId: 'rpt-uuid-11',
      newReportCount: 5,
      threshold: 3,
      capturedAutoHideValues
    });
    const app = buildApp(makeDepsNoRl(db));

    const res = await post(app, VALID_TOKEN, { reason: 'malware' });
    expect(res.status).toBe(200);
    expect(capturedAutoHideValues.length).toBeGreaterThan(0);
  });

  test('does not auto-hide expired file even when above threshold', async () => {
    const capturedAutoHideValues: unknown[] = [];
    const db = makeDb({
      file: makeFile({ status: 'expired' }),
      reportId: 'rpt-uuid-12',
      newReportCount: 10,
      threshold: 3,
      capturedAutoHideValues
    });
    const app = buildApp(makeDepsNoRl(db));

    const res = await post(app, VALID_TOKEN, { reason: 'spam' });
    expect(res.status).toBe(200);
    // expired file is not publicly accessible, auto-hide should NOT trigger
    expect(capturedAutoHideValues.length).toBe(0);
  });

  test('does not auto-hide when report count is below threshold', async () => {
    const capturedAutoHideValues: unknown[] = [];
    const db = makeDb({
      file: makeFile({ status: 'active' }),
      reportId: 'rpt-uuid-13',
      newReportCount: 2,
      threshold: 3,
      capturedAutoHideValues
    });
    const app = buildApp(makeDepsNoRl(db));

    const res = await post(app, VALID_TOKEN, { reason: 'spam' });
    expect(res.status).toBe(200);
    expect(capturedAutoHideValues.length).toBe(0);
  });

  test('handles race condition: returns 200 when another request wins the hide race', async () => {
    const db = makeDb({
      file: makeFile({ status: 'active' }),
      reportId: 'rpt-uuid-14',
      newReportCount: 3,
      threshold: 3,
      autoHideRaceLost: true // update returns [] = already hidden by concurrency
    });
    const app = buildApp(makeDepsNoRl(db));

    const res = await post(app, VALID_TOKEN, { reason: 'spam' });
    // Should still return 200 — the report was persisted successfully
    expect(res.status).toBe(200);
  });

  test('returns 500 when transactional auto-hide insert fails', async () => {
    const db = makeDb({
      file: makeFile({ status: 'active' }),
      reportId: 'rpt-uuid-15',
      newReportCount: 5,
      threshold: 3,
      autoHideInsertShouldThrow: true
    });
    const app = buildApp(makeDepsNoRl(db));

    const res = await post(app, VALID_TOKEN, { reason: 'spam' });
    expect(res.status).toBe(500);
  });

  test('logs automatic hides with api service context and trigger metadata', async () => {
    const db = makeDb({
      file: makeFile({ reportCount: 2 }),
      threshold: 3,
      newReportCount: 3,
      reportId: 'rpt-auto-hide'
    });
    const app = buildApp(makeDepsNoRl(db));
    const originalLog = console.log;
    const entries: Array<Record<string, unknown>> = [];

    console.log = (...args: unknown[]) => {
      const line = args[0];

      if (typeof line !== 'string') {
        return;
      }

      try {
        entries.push(JSON.parse(line) as Record<string, unknown>);
      } catch {}
    };

    try {
      const res = await post(app, VALID_TOKEN, { reason: 'spam' });
      expect(res.status).toBe(200);
    } finally {
      console.log = originalLog;
    }

    const hiddenLog = entries.find((entry) => entry.event === 'file.hidden');

    expect(hiddenLog).toBeDefined();
    expect(hiddenLog?.service).toBe('api');
    expect(hiddenLog?.trigger).toBe('automatic');
    expect(hiddenLog?.requestId).toBeTruthy();
  });

  test('uses default threshold when settings row is not found', async () => {
    const capturedAutoHideValues: unknown[] = [];
    const db = makeDb({
      file: makeFile({ status: 'active' }),
      reportId: 'rpt-uuid-16',
      newReportCount: 3, // equals REPORT_AUTO_HIDE_THRESHOLD_DEFAULT = 3
      threshold: null, // no settings row → fallback to default of 3
      capturedAutoHideValues
    });
    const app = buildApp(makeDepsNoRl(db));

    const res = await post(app, VALID_TOKEN, { reason: 'spam' });
    expect(res.status).toBe(200);
    // Default threshold is 3, newReportCount is 3 → auto-hide triggers
    expect(capturedAutoHideValues.length).toBeGreaterThan(0);
  });

  test('uses the configured auto-hide threshold loader when provided', async () => {
    const capturedAutoHideValues: unknown[] = [];
    const db = makeDb({
      file: makeFile({ status: 'active' }),
      reportId: 'rpt-uuid-17',
      newReportCount: 2,
      capturedAutoHideValues
    });
    const app = buildApp({
      ...makeDepsNoRl(db),
      loadAutoHideThreshold: async () => 2
    });

    const res = await post(app, VALID_TOKEN, { reason: 'spam' });

    expect(res.status).toBe(200);
    expect(capturedAutoHideValues.length).toBeGreaterThan(0);
  });
});

// ── DB failure ────────────────────────────────────────────────────────────────

describe('POST /report/:token — error handling', () => {
  test('returns 500 when the report transaction throws', async () => {
    const db = makeDb({
      file: makeFile({ status: 'active' }),
      transactionShouldThrow: true
    });
    const app = buildApp(makeDepsNoRl(db));

    const res = await post(app, VALID_TOKEN, { reason: 'spam' });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.INTERNAL_ERROR);
  });
});
