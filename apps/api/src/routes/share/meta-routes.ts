import { API_ERROR_CODES } from '@anonshare/contracts';
import { getUnavailabilityMessage, isPubliclyAccessible } from '@anonshare/domain';
import { files } from '@anonshare/infrastructure/db/schema';
import { applyRateLimit, recordRateLimitBlocked } from '@anonshare/infrastructure/rate-limit';
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
  SHARE_DOWNLOAD_RATE_WINDOW_SECONDS,
  SHARE_TOKEN_RATE_LIMIT,
  SHARE_TOKEN_RATE_WINDOW_SECONDS
} from './constants';
import { isExpiredByTimestamp, statusToErrorCode } from './helpers';
import type { ResolvedShareDeps } from './types';

export function registerShareMetaRoutes(router: Hono, deps: ResolvedShareDeps): void {
  // ── GET /:token ─────────────────────────────────────────────────────────────
  // Returns file metadata for display on the public share page.
  // Available files return 200 with full metadata.
  // Unavailable files return 410 with a specific error code so the UI can
  // render a precise state message rather than a generic error.
  router.get('/:token', async (c) => {
    const requestId = getRequestId(c);
    const rawToken = c.req.param('token');
    const token = parseShareToken(rawToken);
    if (!token) {
      return c.json(errorBody(API_ERROR_CODES.NOT_FOUND, 'File not found'), 404);
    }

    const rawIp = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip');
    c.header('cache-control', 'no-store');

    // ── Rate limiting ────────────────────────────────────────────────────────
    const ipHash = await hashIp(rawIp);
    if (ipHash) {
      const shareDownloadRateLimit = await deps.loadDownloadRateLimit();
      const limit = await applyRateLimit(
        deps.redis(),
        `rl:share:${ipHash}`,
        shareDownloadRateLimit,
        SHARE_DOWNLOAD_RATE_WINDOW_SECONDS,
        logger
      );
      if (limit.limited) {
        logger.warn('Rate limit blocked: share metadata', {
          event: 'rate_limit.blocked',
          requestId,
          actor: 'anonymous',
          entity: { type: 'http_request', id: `GET /share/${rawToken}` },
          outcome: 'failure',
          surface: 'share_metadata',
          origin: limit.origin,
          limit: limit.limit,
          count: limit.count,
          resetInSeconds: limit.resetInSeconds
        });
        recordBlockedMetricBestEffort(
          recordRateLimitBlocked(deps.redis(), 'share_metadata'),
          'share_metadata',
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
        logger.warn('Rate limit blocked: share metadata (per-token)', {
          event: 'rate_limit.blocked',
          requestId,
          actor: 'anonymous',
          entity: { type: 'http_request', id: `GET /share/${rawToken}` },
          outcome: 'failure',
          surface: 'share_metadata_token',
          origin: tokenLimit.origin,
          limit: tokenLimit.limit,
          count: tokenLimit.count,
          resetInSeconds: tokenLimit.resetInSeconds
        });
        recordBlockedMetricBestEffort(
          recordRateLimitBlocked(deps.redis(), 'share_metadata_token'),
          'share_metadata_token',
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

    // Keep metadata cacheable only with mandatory revalidation so the browser
    // does not serve stale availability after moderation transitions.
    c.header('cache-control', 'private, no-cache, max-age=0, must-revalidate');
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
}
