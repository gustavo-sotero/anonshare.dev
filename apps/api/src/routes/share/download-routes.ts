import {
  API_ERROR_CODES,
  DOWNLOAD_URL_EXPIRY_SECONDS,
  ONE_TIME_DOWNLOAD_CLEANUP_DELAY_MS
} from '@anonshare/contracts';
import { getUnavailabilityMessage, isPubliclyAccessible } from '@anonshare/domain';
import { downloadEvents, files } from '@anonshare/infrastructure/db/schema';
import { applyRateLimit, recordRateLimitBlocked } from '@anonshare/infrastructure/rate-limit';
import { StorageError } from '@anonshare/infrastructure/storage';
import { and, eq, inArray } from 'drizzle-orm';
import type { Hono } from 'hono';
import { logger } from '../../logger';
import {
  errorBody,
  getRequestId,
  hashIp,
  parseShareToken,
  persistEventBestEffort,
  recordBlockedMetricBestEffort
} from '../support';
import {
  SHARE_DOWNLOAD_RATE_WINDOW_SECONDS,
  SHARE_TOKEN_RATE_LIMIT,
  SHARE_TOKEN_RATE_WINDOW_SECONDS
} from './constants';
import { isExpiredByTimestamp, statusToErrorCode } from './helpers';
import type { ResolvedShareDeps } from './types';

export function registerShareDownloadRoutes(router: Hono, deps: ResolvedShareDeps): void {
  // ── GET /:token/download ────────────────────────────────────────────────────
  // Issues a short-lived presigned download URL.
  //
  // One-time files use a PostgreSQL compare-and-set UPDATE to transition the
  // record to `consumed` atomically before the URL is issued. The first
  // concurrent request to successfully update the row gets the URL; subsequent
  // requests receive 410. This guarantees at-most-one delivery without external
  // locking primitives.
  router.get('/:token/download', async (c) => {
    const requestId = getRequestId(c);
    const rawToken = c.req.param('token');
    const token = parseShareToken(rawToken);
    if (!token) {
      return c.json(errorBody(API_ERROR_CODES.NOT_FOUND, 'File not found'), 404);
    }

    const rawIp = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip');
    const ipHash = await hashIp(rawIp);
    c.header('cache-control', 'no-store');

    // ── Rate limiting ────────────────────────────────────────────────────────
    if (ipHash) {
      const shareDownloadRateLimit = await deps.loadDownloadRateLimit();
      const limit = await applyRateLimit(
        deps.redis(),
        `rl:download:${ipHash}`,
        shareDownloadRateLimit,
        SHARE_DOWNLOAD_RATE_WINDOW_SECONDS,
        logger
      );
      if (limit.limited) {
        logger.warn('Rate limit blocked: download', {
          event: 'rate_limit.blocked',
          requestId,
          actor: 'anonymous',
          entity: { type: 'http_request', id: `GET /share/${rawToken}/download` },
          outcome: 'failure',
          surface: 'download',
          origin: limit.origin,
          limit: limit.limit,
          count: limit.count,
          resetInSeconds: limit.resetInSeconds
        });
        recordBlockedMetricBestEffort(
          recordRateLimitBlocked(deps.redis(), 'download'),
          'download',
          logger
        );
        return c.json(
          errorBody(API_ERROR_CODES.RATE_LIMITED, 'Too many requests. Please try again later.'),
          429
        );
      }

      const tokenLimit = await applyRateLimit(
        deps.redis(),
        `rl:share_token:${token}:${ipHash}`,
        SHARE_TOKEN_RATE_LIMIT,
        SHARE_TOKEN_RATE_WINDOW_SECONDS,
        logger
      );
      if (tokenLimit.limited) {
        logger.warn('Rate limit blocked: download (per-token)', {
          event: 'rate_limit.blocked',
          requestId,
          actor: 'anonymous',
          entity: { type: 'http_request', id: `GET /share/${rawToken}/download` },
          outcome: 'failure',
          surface: 'download_token',
          origin: tokenLimit.origin,
          limit: tokenLimit.limit,
          count: tokenLimit.count,
          resetInSeconds: tokenLimit.resetInSeconds
        });
        recordBlockedMetricBestEffort(
          recordRateLimitBlocked(deps.redis(), 'download_token'),
          'download_token',
          logger
        );
        return c.json(
          errorBody(API_ERROR_CODES.RATE_LIMITED, 'Too many requests. Please try again later.'),
          429
        );
      }
    }

    let file: typeof files.$inferSelect | undefined;
    try {
      file = await deps.db().query.files.findFirst({
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

      persistEventBestEffort(
        deps.db().insert(downloadEvents).values({ fileId: file.id, eventType: 'blocked', ipHash }),
        {
          event: 'download_blocked',
          requestId,
          entity: { type: 'file', id: token },
          eventType: 'blocked'
        },
        logger
      );

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

      persistEventBestEffort(
        deps.db().insert(downloadEvents).values({ fileId: file.id, eventType: 'blocked', ipHash }),
        {
          event: 'download_blocked',
          requestId,
          entity: { type: 'file', id: token },
          eventType: 'blocked'
        },
        logger
      );

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
        consumed = await deps
          .db()
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
        event: 'download.started',
        requestId,
        actor: 'anonymous',
        entity: { type: 'file', id: token },
        outcome: 'success',
        oneTime: true
      });
    } else {
      logger.info('Download started', {
        event: 'download.started',
        requestId,
        actor: 'anonymous',
        entity: { type: 'file', id: token },
        outcome: 'success',
        oneTime: false
      });
    }

    // Record the download_started event (non-blocking; failures are logged).
    persistEventBestEffort(
      deps
        .db()
        .insert(downloadEvents)
        .values({
          fileId: file.id,
          eventType: 'started',
          ipHash,
          context: { oneTime: file.oneTimeDownload }
        }),
      {
        event: 'download.started',
        requestId,
        entity: { type: 'file', id: token },
        eventType: 'started'
      },
      logger
    );

    // ── Generate presigned download URL ───────────────────────────────────────
    let downloadUrl: string;
    try {
      downloadUrl = await deps.storage.createSignedUrl(objectKey, {
        expiresInSeconds: DOWNLOAD_URL_EXPIRY_SECONDS,
        method: 'GET'
      });
    } catch (err) {
      if (oneTimeReservation) {
        try {
          const rollbackResult = await deps
            .db()
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
    persistEventBestEffort(
      deps
        .db()
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
        }),
      {
        event: 'download.completed',
        requestId,
        entity: { type: 'file', id: token },
        eventType: 'completed'
      },
      logger
    );

    logger.info('Download delivered via presigned URL', {
      event: 'download.completed',
      requestId,
      actor: 'anonymous',
      entity: { type: 'file', id: token },
      outcome: 'success',
      oneTime: file.oneTimeDownload,
      source: 'presign_issued'
    });

    if (oneTimeReservation) {
      try {
        await deps.enqueueCleanupFile(
          oneTimeReservation.fileId,
          objectKey,
          ONE_TIME_DOWNLOAD_CLEANUP_DELAY_MS
        );
      } catch (err) {
        logger.warn('One-time cleanup enqueue failed; reconciler will repair', {
          event: 'download.completed',
          requestId,
          actor: 'anonymous',
          entity: { type: 'file', id: token },
          outcome: 'failure',
          reason: 'cleanup_enqueue_failed',
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }

    return c.json({ ok: true as const, data: { url: downloadUrl, expiresAt } }, 200);
  });
}
