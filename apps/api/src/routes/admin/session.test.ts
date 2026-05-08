import { describe, expect, test } from 'bun:test';
import { adminSessionResponseSchema } from '@anonshare/contracts';
import { buildApp, makeSession, makeSignedCookieValue, request } from './test-helpers';

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

    const signedCookie = await makeSignedCookieValue('expired-session');
    const response = await request(app, '/admin/session', { cookie: signedCookie });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ authenticated: false, session: null });
  });
});
