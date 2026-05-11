/**
 * Shared test doubles and builders for the admin router test suite.
 * Imported by the per-route test files.
 */

import type { createDb } from '@anonshare/infrastructure/db';
import { Hono } from 'hono';
import { type AdminRouterDeps, createAdminRouter } from './index';

export type SessionRecord = NonNullable<
  Awaited<ReturnType<NonNullable<AdminRouterDeps['findSessionById']>>>
>;

type QueueReader = ReturnType<NonNullable<AdminRouterDeps['getQueues']>>[number];

export function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    githubId: '123456',
    githubLogin: 'admin-user',
    expiresAt: new Date('2030-01-01T00:00:00Z'),
    revokedAt: null,
    ...overrides
  };
}

export function makeQueue(
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

export const TEST_SESSION_SECRET = 'test-session-secret-is-32-chars!!';

/**
 * Compute a Hono-compatible signed cookie value for use in test requests.
 * Matches the HMAC-SHA256(value, secret) format that setSignedCookie produces.
 */
export async function makeSignedCookieValue(sessionId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(TEST_SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(sessionId));
  const b64 = btoa(String.fromCodePoint(...new Uint8Array(sig)));
  return `anonshare_admin_session=${sessionId}.${encodeURIComponent(b64)}`;
}

export function buildApp(deps: AdminRouterDeps): Hono {
  const app = new Hono();
  app.route(
    '/admin',
    createAdminRouter({
      getSessionSecret: () => TEST_SESSION_SECRET,
      listRateLimitBlockedCountsByDay: deps.listRateLimitBlockedCountsByDay ?? (async () => []),
      ...deps
    })
  );
  return app;
}

export async function request(
  app: Hono,
  path: string,
  headers: Record<string, string> = {}
): Promise<Response> {
  const resolvedHeaders = { ...headers };
  // Transparently convert the legacy test bypass header to a proper signed cookie
  if ('x-admin-session-id' in resolvedHeaders) {
    const sessionId = resolvedHeaders['x-admin-session-id'];
    delete resolvedHeaders['x-admin-session-id'];
    resolvedHeaders.cookie = await makeSignedCookieValue(sessionId);
  }
  return app.request(`http://localhost${path}`, {
    method: 'GET',
    headers: resolvedHeaders
  });
}

// ── DB row types ──────────────────────────────────────────────────────────────

export type AdminFileRow = {
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

export type AdminReportRow = {
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

export function makeAdminFile(overrides: Partial<AdminFileRow> = {}): AdminFileRow {
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

export function makeAdminReport(overrides: Partial<AdminReportRow> = {}): AdminReportRow {
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

export type AdminDbOpts = {
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

export function makeAdminDb(opts: AdminDbOpts = {}): ReturnType<typeof createDb> {
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

export const FIXED_ADMIN_NOW = new Date('2026-03-15T10:00:00Z');

export function makeAuthDeps(
  db: ReturnType<typeof createDb>,
  extra: Partial<AdminRouterDeps> = {}
): AdminRouterDeps {
  return {
    findSessionById: async () => makeSession({ id: 'session-1' }),
    getSessionSecret: () => TEST_SESSION_SECRET,
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

export async function jsonPost(
  app: Hono,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  const cookieValue = await makeSignedCookieValue('session-1');
  return app.request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: cookieValue,
      ...headers
    },
    body: JSON.stringify(body)
  });
}
