import { describe, expect, test } from 'bun:test';
import {
  buildApp,
  FIXED_ADMIN_NOW,
  jsonPost,
  makeAdminDb,
  makeAdminFile,
  makeAdminReport,
  makeAuthDeps,
  request
} from './test-helpers';

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
            return {
              id: 'session-1',
              githubId: '123456',
              githubLogin: 'audit-admin',
              expiresAt: new Date('2030-01-01T00:00:00Z'),
              revokedAt: null
            };
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

  test('logs manual moderation with api service context and trigger metadata', async () => {
    const file = makeAdminFile({ status: 'active' });
    const db = makeAdminDb({ fileLookup: file });
    const app = buildApp(makeAuthDeps(db));
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
      const response = await jsonPost(
        app,
        `/admin/files/${file.id}/moderate`,
        { action: 'hide', reason: 'Manual hide' },
        { 'x-admin-session-id': 'session-1' }
      );

      expect(response.status).toBe(200);
    } finally {
      console.log = originalLog;
    }

    const hiddenLog = entries.find((entry) => entry.event === 'file.hidden');

    expect(hiddenLog).toBeDefined();
    expect(hiddenLog?.service).toBe('api');
    expect(hiddenLog?.trigger).toBe('manual');
    expect(hiddenLog?.requestId).toBeTruthy();
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

  test('logs file.deleted with api service context and manual trigger metadata', async () => {
    const file = makeAdminFile({ status: 'active' });
    const db = makeAdminDb({ fileLookup: file });
    const app = buildApp(makeAuthDeps(db));
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
      const response = await jsonPost(
        app,
        `/admin/files/${file.id}/moderate`,
        { action: 'delete' },
        { 'x-admin-session-id': 'session-1' }
      );

      expect(response.status).toBe(200);
    } finally {
      console.log = originalLog;
    }

    const deletedLog = entries.find((entry) => entry.event === 'file.deleted');

    expect(deletedLog).toBeDefined();
    expect(deletedLog?.service).toBe('api');
    expect(deletedLog?.trigger).toBe('manual');
    expect(deletedLog?.requestId).toBeTruthy();
    expect(deletedLog?.entity).toEqual({ type: 'file', id: file.id });
    expect(deletedLog?.outcome).toBe('success');
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
