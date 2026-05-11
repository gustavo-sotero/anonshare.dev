import { describe, expect, test } from 'bun:test';
import {
  buildApp,
  FIXED_ADMIN_NOW,
  jsonPost,
  makeAdminDb,
  makeAdminReport,
  makeAuthDeps,
  makeSession,
  request
} from './test-helpers';

describe('GET /admin/reports', () => {
  test('returns 401 when no session is present', async () => {
    const db = makeAdminDb();
    const app = buildApp({
      ...makeAuthDeps(db),
      findSessionById: async () => null
    });

    const response = await app.request('http://localhost/admin/reports', { method: 'GET' });
    expect(response.status).toBe(401);
  });

  test('returns paginated list of reports', async () => {
    const report = makeAdminReport();
    const db = makeAdminDb({ selectResults: [[report]] });
    const app = buildApp(makeAuthDeps(db));

    const response = await request(app, '/admin/reports', { 'x-admin-session-id': 'session-1' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reports).toHaveLength(1);
    expect(body.reports[0].id).toBe(report.id);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });

  test('accepts status and fileId query filters', async () => {
    const db = makeAdminDb({ selectResults: [[]] });
    const app = buildApp(makeAuthDeps(db));

    const response = await request(
      app,
      '/admin/reports?status=pending&fileId=00000000-0000-4000-8000-000000000099',
      { 'x-admin-session-id': 'session-1' }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.reports).toHaveLength(0);
  });

  test('accepts reason and urgency query filters', async () => {
    const db = makeAdminDb({ selectResults: [[]] });
    const app = buildApp(makeAuthDeps(db));

    const response = await request(app, '/admin/reports?reason=malware&urgency=high', {
      'x-admin-session-id': 'session-1'
    });
    expect(response.status).toBe(200);
  });

  test('returns 400 for invalid status value', async () => {
    const db = makeAdminDb();
    const app = buildApp(makeAuthDeps(db));

    const response = await request(app, '/admin/reports?status=not_a_valid_status', {
      'x-admin-session-id': 'session-1'
    });
    expect(response.status).toBe(400);
  });

  test('accepts a valid cursor and returns the first page', async () => {
    const cursor = Buffer.from(
      JSON.stringify({ s: '2026-02-01T08:00:00.000Z', i: '00000000-0000-4000-8000-000000000001' }),
      'utf-8'
    ).toString('base64url');

    const db = makeAdminDb({ selectResults: [[]] });
    const app = buildApp(makeAuthDeps(db));

    const response = await request(app, `/admin/reports?cursor=${encodeURIComponent(cursor)}`, {
      'x-admin-session-id': 'session-1'
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ reports: [], hasMore: false, nextCursor: null });
  });

  test('falls back to first page when cursor is malformed', async () => {
    const db = makeAdminDb({ selectResults: [[]] });
    const app = buildApp(makeAuthDeps(db));

    const response = await request(app, '/admin/reports?cursor=!!!not-base64url!!!', {
      'x-admin-session-id': 'session-1'
    });

    expect(response.status).toBe(200);
  });
});

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

  test('reuses the validated session for audit fields in the resolved report', async () => {
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

          throw new Error('session should not be looked up a second time');
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

  test('returns 404 when report id is unknown', async () => {
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

  test('returns 400 for invalid resolve action', async () => {
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
