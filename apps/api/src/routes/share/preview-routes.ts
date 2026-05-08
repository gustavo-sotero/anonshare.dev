import { API_ERROR_CODES } from '@anonshare/contracts';
import {
  getUnavailabilityMessage,
  isPreviewSupported,
  isPubliclyAccessible
} from '@anonshare/domain';
import { files } from '@anonshare/infrastructure/db/schema';
import { applyRateLimit, recordRateLimitBlocked } from '@anonshare/infrastructure/rate-limit';
import { StorageError } from '@anonshare/infrastructure/storage';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { logger } from '../../logger';
import {
  errorBody,
  getRequestId,
  hashIp,
  parseShareToken,
  recordBlockedMetricBestEffort
} from '../support';
import {
  PREVIEW_URL_EXPIRY_SECONDS,
  SHARE_DOWNLOAD_RATE_WINDOW_SECONDS,
  SHARE_TOKEN_RATE_LIMIT,
  SHARE_TOKEN_RATE_WINDOW_SECONDS
} from './constants';
import { isExpiredByTimestamp, statusToErrorCode } from './helpers';
import type { ResolvedShareDeps } from './types';

export function registerSharePreviewRoutes(router: Hono, deps: ResolvedShareDeps): void {
  // ── GET /:token/preview ─────────────────────────────────────────────────────
  // Issues a presigned URL for in-browser preview rendering.
  // Prerequisites: file accessible, allowPreview=true, not one-time, MIME in allowlist.
  router.get('/:token/preview', async (c) => {
    const requestId = getRequestId(c);
    const rawToken = c.req.param('token');
    const token = parseShareToken(rawToken);
    if (!token) {
      return c.json(errorBody(API_ERROR_CODES.NOT_FOUND, 'File not found'), 404);
    }

    c.header('cache-control', 'no-store');

    // ── Rate limiting ────────────────────────────────────────────────────────
    const rawIpPreview = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip');
    const previewIpHash = rawIpPreview ? await hashIp(rawIpPreview) : null;
    if (previewIpHash) {
      const shareDownloadRateLimit = await deps.loadDownloadRateLimit();
      const limit = await applyRateLimit(
        deps.redis(),
        `rl:preview:${previewIpHash}`,
        shareDownloadRateLimit,
        SHARE_DOWNLOAD_RATE_WINDOW_SECONDS,
        logger
      );
      if (limit.limited) {
        logger.warn('Rate limit blocked: preview', {
          event: 'rate_limit.blocked',
          requestId,
          actor: 'anonymous',
          entity: { type: 'http_request', id: `GET /share/${rawToken}/preview` },
          outcome: 'failure',
          surface: 'preview',
          origin: limit.origin,
          limit: limit.limit,
          count: limit.count,
          resetInSeconds: limit.resetInSeconds
        });
        recordBlockedMetricBestEffort(
          recordRateLimitBlocked(deps.redis(), 'preview'),
          'preview',
          logger
        );
        return c.json(
          errorBody(API_ERROR_CODES.RATE_LIMITED, 'Too many requests. Please try again later.'),
          429
        );
      }

      const tokenLimit = await applyRateLimit(
        deps.redis(),
        `rl:share_token:${token}:${previewIpHash}`,
        SHARE_TOKEN_RATE_LIMIT,
        SHARE_TOKEN_RATE_WINDOW_SECONDS,
        logger
      );
      if (tokenLimit.limited) {
        logger.warn('Rate limit blocked: preview (per-token)', {
          event: 'rate_limit.blocked',
          requestId,
          actor: 'anonymous',
          entity: { type: 'http_request', id: `GET /share/${rawToken}/preview` },
          outcome: 'failure',
          surface: 'preview_token',
          origin: tokenLimit.origin,
          limit: tokenLimit.limit,
          count: tokenLimit.count,
          resetInSeconds: tokenLimit.resetInSeconds
        });
        recordBlockedMetricBestEffort(
          recordRateLimitBlocked(deps.redis(), 'preview_token'),
          'preview_token',
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
      previewUrl = await deps.storage.createSignedUrl(file.objectKey, {
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
}
