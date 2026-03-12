import { API_ERROR_CODES, shareTokenParamsSchema } from '@anonshare/contracts';
import {
  getUnavailabilityMessage,
  isPreviewSupported,
  isPubliclyAccessible
} from '@anonshare/domain';
import { createDb } from '@anonshare/infrastructure/db';
import { downloadEvents, files } from '@anonshare/infrastructure/db/schema';
import { logger } from '@anonshare/infrastructure/logger';
import type { StorageSignedUrlOptions } from '@anonshare/infrastructure/storage';
import { StorageError, storageAdapter } from '@anonshare/infrastructure/storage';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';

// ─── Constants ────────────────────────────────────────────────────────────────
const DOWNLOAD_URL_EXPIRY_SECONDS = 900; // 15 minutes
const PREVIEW_URL_EXPIRY_SECONDS = 3600; // 1 hour

// ─── Lazy DB singleton ────────────────────────────────────────────────────────
let _db: ReturnType<typeof createDb> | null = null;

function getDb() {
  if (!_db) _db = createDb();
  return _db;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Pseudonymise an IP address for download event logging.
 * PRD §8.2: Never store plaintext IPs for anonymous operations.
 */
async function hashIp(raw?: string): Promise<string | null> {
  if (!raw) return null;
  const firstIp = raw.split(',')[0];
  if (!firstIp) return null;
  const data = new TextEncoder().encode(firstIp.trim());
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Buffer.from(digest).toString('hex').slice(0, 32);
}

function errorBody(code: string, message: string) {
  return { ok: false as const, error: { code, message } };
}

function parseShareToken(token: string): string | null {
  const parsed = shareTokenParamsSchema.safeParse({ token });
  if (!parsed.success) {
    return null;
  }

  return parsed.data.token;
}

/**
 * Map a file status to the most specific API error code.
 * Collapsed status values (hidden, missing) use the generic unavailable code
 * to avoid leaking internal state to anonymous callers.
 */
function statusToErrorCode(status: string): string {
  switch (status) {
    case 'expired':
      return API_ERROR_CODES.FILE_EXPIRED;
    case 'hidden':
      return API_ERROR_CODES.FILE_HIDDEN;
    case 'deleted':
      return API_ERROR_CODES.FILE_DELETED;
    case 'consumed':
      return API_ERROR_CODES.FILE_CONSUMED;
    default:
      return API_ERROR_CODES.FILE_UNAVAILABLE;
  }
}

/**
 * Returns true when a file's expiration timestamp has passed, even if the
 * background job has not yet updated the stored status. This enforces
 * expiration at read time so that the public interface blocks access
 * immediately — independent of cleanup job execution.
 *
 * Only applies to publicly-accessible statuses (active / expiring); files
 * already in a terminal state have their own unavailability handling.
 */
function isExpiredByTimestamp(file: { status: string; expiresAt: Date | null }): boolean {
  if (file.status !== 'active' && file.status !== 'expiring') return false;
  if (!file.expiresAt) return false;
  return file.expiresAt <= new Date();
}

// ─── Dependency injection types ───────────────────────────────────────────────

type ShareStorage = {
  createSignedUrl(key: string, options: StorageSignedUrlOptions): Promise<string>;
};

export type ShareRouterDeps = {
  getDb?: () => ReturnType<typeof createDb>;
  storage?: ShareStorage;
};

// ─── Router factory ───────────────────────────────────────────────────────────

export function createShareRouter(deps: ShareRouterDeps = {}): Hono {
  const resolveDb = deps.getDb ?? getDb;
  const resolveStorage: ShareStorage = deps.storage ?? storageAdapter;

  const router = new Hono();

  // ── GET /:token ─────────────────────────────────────────────────────────────
  // Returns file metadata for display on the public share page.
  // Available files return 200 with full metadata.
  // Unavailable files return 410 with a specific error code so the UI can
  // render a precise state message rather than a generic error.
  router.get('/:token', async (c) => {
    const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
    const rawToken = c.req.param('token');
    c.header('cache-control', 'no-store');

    const token = parseShareToken(rawToken);
    if (!token) {
      return c.json(errorBody(API_ERROR_CODES.NOT_FOUND, 'File not found'), 404);
    }

    let file: typeof files.$inferSelect | undefined;
    try {
      file = await resolveDb().query.files.findFirst({
        where: eq(files.token, token)
      });
    } catch (err) {
      logger.error('Share metadata: database query failed', {
        event: 'share_metadata_failed',
        requestId,
        actor: 'anonymous',
        entity: { type: 'file', id: token },
        outcome: 'failure',
        error: err instanceof Error ? err.message : String(err)
      });
      return c.json(errorBody(API_ERROR_CODES.INTERNAL_ERROR, 'An internal error occurred'), 500);
    }

    if (!file) {
      c.header('cache-control', 'no-store');
      return c.json(errorBody(API_ERROR_CODES.NOT_FOUND, 'File not found'), 404);
    }

    // Enforce expiration at read time regardless of whether the background job
    // has already updated the status. This guarantees immediate inaccessibility.
    if (isExpiredByTimestamp(file)) {
      c.header('cache-control', 'no-store');
      return c.json(errorBody(API_ERROR_CODES.FILE_EXPIRED, 'This file has expired'), 410);
    }

    const unavailabilityMessage = getUnavailabilityMessage(file.status);

    if (!isPubliclyAccessible(file.status)) {
      // Do not cache unavailable state responses — they may become stale (e.g.
      // admin restores a hidden file) and subsequent requests must see the
      // updated state.
      c.header('cache-control', 'no-store');
      return c.json(
        errorBody(
          statusToErrorCode(file.status),
          unavailabilityMessage ?? 'This file is unavailable'
        ),
        410
      );
    }

    // Allow brief private caching of metadata for active/expiring files.
    // Private prevents CDN caching of access-controlled content; max-age=60
    // is short enough to reflect state transitions within a minute.
    c.header('cache-control', 'private, max-age=60');
    return c.json(
      {
        ok: true as const,
        data: {
          shareToken: file.token,
          filename: file.sanitizedFilename,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          status: file.status,
          oneTime: file.oneTimeDownload,
          allowPreview: file.allowPreview,
          expiresAt: file.expiresAt?.toISOString() ?? null,
          createdAt: file.uploadedAt.toISOString()
        }
      },
      200
    );
  });

  // ── GET /:token/download ────────────────────────────────────────────────────
  // Issues a short-lived presigned download URL.
  //
  // One-time files use a PostgreSQL compare-and-set UPDATE to transition the
  // record to `consumed` atomically before the URL is issued. The first
  // concurrent request to successfully update the row gets the URL; subsequent
  // requests receive 410. This guarantees at-most-one delivery without external
  // locking primitives.
  router.get('/:token/download', async (c) => {
    const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
    const rawToken = c.req.param('token');
    const rawIp = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip');
    const ipHash = await hashIp(rawIp);
    c.header('cache-control', 'no-store');

    const token = parseShareToken(rawToken);
    if (!token) {
      return c.json(errorBody(API_ERROR_CODES.NOT_FOUND, 'File not found'), 404);
    }

    let file: typeof files.$inferSelect | undefined;
    try {
      file = await resolveDb().query.files.findFirst({
        where: eq(files.token, token)
      });
    } catch (err) {
      logger.error('Download: database query failed', {
        event: 'download_blocked',
        requestId,
        actor: 'anonymous',
        entity: { type: 'file', id: token },
        outcome: 'failure',
        error: err instanceof Error ? err.message : String(err)
      });
      return c.json(errorBody(API_ERROR_CODES.INTERNAL_ERROR, 'An internal error occurred'), 500);
    }

    if (!file) {
      return c.json(errorBody(API_ERROR_CODES.NOT_FOUND, 'File not found'), 404);
    }

    // Enforce expiration at read time, independent of background job execution.
    if (isExpiredByTimestamp(file)) {
      logger.info('Download blocked: file expired by timestamp', {
        event: 'download_blocked',
        requestId,
        actor: 'anonymous',
        entity: { type: 'file', id: token },
        outcome: 'failure',
        reason: 'expired_by_timestamp'
      });

      resolveDb()
        .insert(downloadEvents)
        .values({ fileId: file.id, eventType: 'blocked', ipHash })
        .catch(() => {});

      return c.json(errorBody(API_ERROR_CODES.FILE_EXPIRED, 'This file has expired'), 410);
    }

    if (!isPubliclyAccessible(file.status)) {
      const code = statusToErrorCode(file.status);
      const message = getUnavailabilityMessage(file.status) ?? 'This file is unavailable';

      logger.info('Download blocked: file unavailable', {
        event: 'download_blocked',
        requestId,
        actor: 'anonymous',
        entity: { type: 'file', id: token },
        outcome: 'failure',
        reason: file.status
      });

      resolveDb()
        .insert(downloadEvents)
        .values({ fileId: file.id, eventType: 'blocked', ipHash })
        .catch(() => {});

      return c.json(errorBody(code, message), 410);
    }

    let objectKey: string = file.objectKey;
    let oneTimeReservation: {
      fileId: string;
      previousStatus: 'active' | 'expiring';
    } | null = null;

    // ── One-time: atomic consumption via compare-and-set ─────────────────────
    if (file.oneTimeDownload) {
      let consumed: Array<{ id: string; objectKey: string }>;

      try {
        consumed = await resolveDb()
          .update(files)
          .set({ status: 'consumed', consumedAt: new Date() })
          .where(
            and(
              eq(files.token, token),
              eq(files.oneTimeDownload, true),
              inArray(files.status, ['active', 'expiring'])
            )
          )
          .returning({ id: files.id, objectKey: files.objectKey });
      } catch (err) {
        logger.error('Download: one-time consumption update failed', {
          event: 'download_blocked',
          requestId,
          actor: 'anonymous',
          entity: { type: 'file', id: token },
          outcome: 'failure',
          error: err instanceof Error ? err.message : String(err)
        });
        return c.json(errorBody(API_ERROR_CODES.INTERNAL_ERROR, 'An internal error occurred'), 500);
      }

      if (consumed.length === 0) {
        // Status changed between the initial read and the UPDATE — another
        // concurrent request won the race or the file expired in the interim.
        logger.info('Download blocked: one-time file consumed in race', {
          event: 'download_blocked',
          requestId,
          actor: 'anonymous',
          entity: { type: 'file', id: token },
          outcome: 'failure',
          reason: 'race_consumed'
        });
        return c.json(
          errorBody(API_ERROR_CODES.FILE_CONSUMED, 'This file has already been downloaded.'),
          410
        );
      }

      const firstConsumed = consumed[0];
      if (!firstConsumed) {
        // Defensive: consumed.length > 0 was checked, but TypeScript can't infer it.
        return c.json(errorBody(API_ERROR_CODES.INTERNAL_ERROR, 'An internal error occurred'), 500);
      }
      objectKey = firstConsumed.objectKey;
      oneTimeReservation = {
        fileId: firstConsumed.id,
        previousStatus: file.status === 'expiring' ? 'expiring' : 'active'
      };

      logger.info('One-time download reserved', {
        event: 'download_started',
        requestId,
        actor: 'anonymous',
        entity: { type: 'file', id: token },
        outcome: 'success',
        oneTime: true
      });
    } else {
      logger.info('Download started', {
        event: 'download_started',
        requestId,
        actor: 'anonymous',
        entity: { type: 'file', id: token },
        outcome: 'success',
        oneTime: false
      });
    }

    // Record the download_started event (best-effort; does not block delivery).
    resolveDb()
      .insert(downloadEvents)
      .values({
        fileId: file.id,
        eventType: 'started',
        ipHash,
        context: { oneTime: file.oneTimeDownload }
      })
      .catch(() => {});

    // ── Generate presigned download URL ───────────────────────────────────────
    let downloadUrl: string;
    try {
      downloadUrl = await resolveStorage.createSignedUrl(objectKey, {
        expiresInSeconds: DOWNLOAD_URL_EXPIRY_SECONDS,
        method: 'GET'
      });
    } catch (err) {
      if (oneTimeReservation) {
        try {
          const rollbackResult = await resolveDb()
            .update(files)
            .set({ status: oneTimeReservation.previousStatus, consumedAt: null })
            .where(and(eq(files.id, oneTimeReservation.fileId), eq(files.status, 'consumed')))
            .returning({ id: files.id });

          logger.warn('One-time reservation rollback after presign failure', {
            event: 'download_consumption_reverted',
            requestId,
            actor: 'anonymous',
            entity: { type: 'file', id: token },
            outcome: rollbackResult.length > 0 ? 'success' : 'failure',
            reason: rollbackResult.length > 0 ? 'presign_failed' : 'rollback_not_applied'
          });
        } catch (rollbackErr) {
          logger.error('One-time reservation rollback failed after presign failure', {
            event: 'download_consumption_reverted',
            requestId,
            actor: 'anonymous',
            entity: { type: 'file', id: token },
            outcome: 'failure',
            reason: 'rollback_failed',
            error: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)
          });
        }
      }

      logger.error('Download: presigned URL generation failed', {
        event: 'download_blocked',
        requestId,
        actor: 'anonymous',
        entity: { type: 'file', id: token },
        outcome: 'failure',
        storageErrorKind: err instanceof StorageError ? err.kind : undefined,
        error: err instanceof Error ? err.message : String(err)
      });
      return c.json(
        errorBody(API_ERROR_CODES.INTERNAL_ERROR, 'Failed to generate download URL'),
        500
      );
    }

    // Presigned URLs are ephemeral secrets — prevent any intermediate caching.
    c.header('cache-control', 'no-store, private');

    const expiresAt = new Date(Date.now() + DOWNLOAD_URL_EXPIRY_SECONDS * 1000).toISOString();

    // Presigned URL issuance is the reliable backend delivery point for both
    // standard and one-time downloads. Record completion here so telemetry does
    // not depend on a best-effort client callback.
    resolveDb()
      .insert(downloadEvents)
      .values({
        fileId: file.id,
        eventType: 'completed',
        ipHash,
        context: {
          oneTime: file.oneTimeDownload,
          deliveredViaPresignedUrl: true,
          source: 'presign_issued'
        }
      })
      .catch(() => {});

    logger.info('Download delivered via presigned URL', {
      event: 'download_completed',
      requestId,
      actor: 'anonymous',
      entity: { type: 'file', id: token },
      outcome: 'success',
      oneTime: file.oneTimeDownload,
      source: 'presign_issued'
    });

    return c.json({ ok: true as const, data: { url: downloadUrl, expiresAt } }, 200);
  });

  // ── POST /:token/download/ack ——————————————————————————————————————
  // Backward-compatibility no-op for older clients that still post acknowledgments.
  // Completion is recorded server-side when the presigned URL is issued.
  router.post('/:token/download/ack', (c) => {
    c.header('cache-control', 'no-store');
    return c.body(null, 204);
  });

  // ── GET /:token/preview ─────────────────────────────────────────────────────
  // Issues a presigned URL for in-browser preview rendering.
  // Prerequisites: file accessible, allowPreview=true, not one-time, MIME in allowlist.
  router.get('/:token/preview', async (c) => {
    const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
    const rawToken = c.req.param('token');
    c.header('cache-control', 'no-store');

    const token = parseShareToken(rawToken);
    if (!token) {
      return c.json(errorBody(API_ERROR_CODES.NOT_FOUND, 'File not found'), 404);
    }

    let file: typeof files.$inferSelect | undefined;
    try {
      file = await resolveDb().query.files.findFirst({
        where: eq(files.token, token)
      });
    } catch (err) {
      logger.error('Preview: database query failed', {
        event: 'preview_blocked',
        requestId,
        actor: 'anonymous',
        entity: { type: 'file', id: token },
        outcome: 'failure',
        error: err instanceof Error ? err.message : String(err)
      });
      return c.json(errorBody(API_ERROR_CODES.INTERNAL_ERROR, 'An internal error occurred'), 500);
    }

    if (!file) {
      return c.json(errorBody(API_ERROR_CODES.NOT_FOUND, 'File not found'), 404);
    }

    // Enforce expiration at read time, independent of background job execution.
    if (isExpiredByTimestamp(file)) {
      return c.json(errorBody(API_ERROR_CODES.FILE_EXPIRED, 'This file has expired'), 410);
    }

    if (!isPubliclyAccessible(file.status)) {
      const code = statusToErrorCode(file.status);
      const message = getUnavailabilityMessage(file.status) ?? 'This file is unavailable';
      return c.json(errorBody(code, message), 410);
    }

    if (!file.allowPreview) {
      return c.json(
        errorBody(API_ERROR_CODES.FILE_UNAVAILABLE, 'Preview is not enabled for this file.'),
        403
      );
    }

    if (file.oneTimeDownload) {
      return c.json(
        errorBody(
          API_ERROR_CODES.FILE_UNAVAILABLE,
          'Preview is not available for one-time download files.'
        ),
        403
      );
    }

    if (!isPreviewSupported(file.mimeType)) {
      return c.json(
        errorBody(API_ERROR_CODES.FILE_UNAVAILABLE, 'Preview is not supported for this file type.'),
        422
      );
    }

    let previewUrl: string;
    try {
      previewUrl = await resolveStorage.createSignedUrl(file.objectKey, {
        expiresInSeconds: PREVIEW_URL_EXPIRY_SECONDS,
        method: 'GET'
      });
    } catch (err) {
      logger.error('Preview: presigned URL generation failed', {
        event: 'preview_blocked',
        requestId,
        actor: 'anonymous',
        entity: { type: 'file', id: token },
        outcome: 'failure',
        storageErrorKind: err instanceof StorageError ? err.kind : undefined,
        error: err instanceof Error ? err.message : String(err)
      });
      return c.json(
        errorBody(API_ERROR_CODES.INTERNAL_ERROR, 'Failed to generate preview URL'),
        500
      );
    }

    // Presigned preview URLs are ephemeral secrets — prevent any caching.
    c.header('cache-control', 'no-store, private');

    const expiresAt = new Date(Date.now() + PREVIEW_URL_EXPIRY_SECONDS * 1000).toISOString();
    return c.json(
      { ok: true as const, data: { url: previewUrl, expiresAt, mimeType: file.mimeType } },
      200
    );
  });

  return router;
}

export const shareRouter = createShareRouter();
