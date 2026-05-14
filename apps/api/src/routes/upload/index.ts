import { API_ERROR_CODES, uploadRequestSchema } from '@anonshare/contracts';
import { getMaxExpirationDate, MAX_FILE_SIZE_BYTES } from '@anonshare/domain';
import { app as appConfig, loadSystemSettingOrDefault } from '@anonshare/infrastructure/config';
import { files } from '@anonshare/infrastructure/db/schema';
import { applyRateLimit, recordRateLimitBlocked } from '@anonshare/infrastructure/rate-limit';
import { getRedisClient } from '@anonshare/infrastructure/redis';
import { storageAdapter } from '@anonshare/infrastructure/storage';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { logger } from '../../logger';
import { enqueueCleanupFileJob, enqueueExpireFileJob } from '../../queues';
import {
  errorBody,
  getRequestId,
  hashIp,
  recordBlockedMetricBestEffort,
  getDb as sharedGetDb
} from '../support';
import {
  generateObjectKey,
  generateShareToken,
  sanitizeFilename,
  storageErrorContext
} from './helpers';
import type { UploadRouterDeps, UploadStorage } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────
const UPLOAD_RATE_WINDOW_SECONDS = 3600;
const REPLAYABLE_UPLOAD_BUFFER_BYTES = 8 * 1024 * 1024;

const getDb = sharedGetDb;
const hashIpForRateLimit = hashIp;

async function resolveStorageBody(file: File): Promise<ReadableStream | Uint8Array> {
  if (file.size > REPLAYABLE_UPLOAD_BUFFER_BYTES) {
    return file.stream();
  }

  return new Uint8Array(await file.arrayBuffer());
}

/**
 * Create the upload router with optional injectable dependencies.
 *
 * In production, call `createUploadRouter()` with no arguments to get the
 * singleton-backed router. In tests, pass mock `getDb` and `storage` to
 * isolate the handler from real infrastructure.
 */
export function createUploadRouter(deps: UploadRouterDeps = {}): Hono {
  const resolveDb = deps.getDb ?? getDb;
  const resolveStorage: UploadStorage = deps.storage ?? storageAdapter;
  const resolveEnqueueExpireFile = deps.enqueueExpireFile ?? enqueueExpireFileJob;
  const resolveEnqueueCleanupFile = deps.enqueueCleanupFile ?? enqueueCleanupFileJob;
  const resolveGetRedis = deps.getRedis ?? getRedisClient;
  const resolveLoadUploadRateLimit =
    deps.loadUploadRateLimit ??
    (() => loadSystemSettingOrDefault(resolveDb(), 'uploadRateLimitPerHour'));

  const router = new Hono();

  /**
   * POST /upload
   *
   * Accepts multipart/form-data with the following fields:
   *   file        — the binary file (required)
   *   oneTime     — "true" | "false"  (default "false")
   *   allowPreview — "true" | "false" (default "false")
   *   expiresAt   — optional ISO-8601 datetime string; when omitted the file
   *                 defaults to the maximum 30-day lifetime
   *
   * Lifecycle:
   *   1. Validate metadata and file size.
   *   2. Insert a `pending_upload` record so the reconciler can detect partial failures.
   *   3. Write the file object to storage.
   *   4. Confirm the object is readable through storage metadata.
   *   5. Promote the record to `active`, or directly to `expired` if the
   *      configured deadline elapsed while the upload was being finalized.
   *   On any storage failure, delete the pending record (compensation).
   *   On activation failure the record stays as `pending_upload`;
   *   the reconciler will promote it when it detects the live storage object.
   */
  router.post('/', async (c) => {
    const requestId = getRequestId(c);

    // ── Rate limiting ─────────────────────────────────────────────────────────
    const rawIp = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip');
    const ipHash = await hashIpForRateLimit(rawIp);
    if (ipHash) {
      const uploadRateLimitPerHour = await resolveLoadUploadRateLimit();
      const limit = await applyRateLimit(
        resolveGetRedis(),
        `rl:upload:${ipHash}`,
        uploadRateLimitPerHour,
        UPLOAD_RATE_WINDOW_SECONDS,
        logger
      );

      if (limit.limited) {
        logger.warn('Rate limit blocked: upload', {
          event: 'rate_limit.blocked',
          requestId,
          actor: 'anonymous',
          entity: { type: 'http_request', id: 'POST /upload' },
          outcome: 'failure',
          surface: 'upload',
          origin: limit.origin,
          limit: limit.limit,
          count: limit.count,
          resetInSeconds: limit.resetInSeconds
        });
        recordBlockedMetricBestEffort(
          recordRateLimitBlocked(resolveGetRedis(), 'upload'),
          'upload',
          logger
        );
        return c.json(
          errorBody(API_ERROR_CODES.RATE_LIMITED, 'Too many uploads. Please try again later.'),
          429
        );
      }
    }

    // ── Pre-flight size guard ─────────────────────────────────────────────────
    // Reject obviously oversized requests before buffering the full body.
    const clHeader = c.req.header('content-length');
    if (clHeader) {
      const cl = Number(clHeader);
      if (!Number.isNaN(cl) && cl > MAX_FILE_SIZE_BYTES + 65_536) {
        logger.warn('Upload rejected: declared content exceeds size limit', {
          event: 'upload_validation_failed',
          requestId,
          actor: 'anonymous',
          outcome: 'failure',
          reason: 'content_length_exceeded',
          contentLength: cl
        });
        return c.json(errorBody(API_ERROR_CODES.FILE_TOO_LARGE, 'File exceeds 256 MB limit'), 413);
      }
    }

    // ── Parse multipart form ──────────────────────────────────────────────────
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      logger.warn('Upload rejected: invalid multipart form data', {
        event: 'upload_validation_failed',
        requestId,
        actor: 'anonymous',
        outcome: 'failure',
        reason: 'invalid_multipart_form_data'
      });
      return c.json(
        errorBody(API_ERROR_CODES.VALIDATION_ERROR, 'Invalid multipart form data'),
        400
      );
    }

    const fileField = form.get('file');
    if (!(fileField instanceof File)) {
      logger.warn('Upload rejected: missing file field', {
        event: 'upload_validation_failed',
        requestId,
        actor: 'anonymous',
        outcome: 'failure',
        reason: 'missing_file_field'
      });
      return c.json(
        errorBody(API_ERROR_CODES.VALIDATION_ERROR, 'Missing required field: file'),
        400
      );
    }

    // ── Explicit file-size check (returns 413, not a generic 400) ─────────────
    if (fileField.size > MAX_FILE_SIZE_BYTES) {
      logger.warn('Upload rejected: file exceeds size limit', {
        event: 'upload_validation_failed',
        requestId,
        actor: 'anonymous',
        outcome: 'failure',
        reason: 'file_too_large',
        sizeBytes: fileField.size
      });
      return c.json(errorBody(API_ERROR_CODES.FILE_TOO_LARGE, 'File exceeds 256 MB limit'), 413);
    }

    // ── Validate metadata ─────────────────────────────────────────────────────
    const rawMetadata = {
      filename: fileField.name || 'upload',
      mimeType: fileField.type || 'application/octet-stream',
      sizeBytes: fileField.size,
      oneTime: form.get('oneTime') === 'true',
      allowPreview: form.get('allowPreview') === 'true',
      expiresAt: (form.get('expiresAt') as string | null) || null
    };

    const parsed = uploadRequestSchema.safeParse(rawMetadata);
    if (!parsed.success) {
      const details: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join('.') || 'root';
        if (!(path in details)) {
          details[path] = issue.message;
        }
      }
      logger.warn('Upload rejected: metadata validation failed', {
        event: 'upload_validation_failed',
        requestId,
        actor: 'anonymous',
        outcome: 'failure',
        details
      });
      return c.json(
        errorBody(API_ERROR_CODES.VALIDATION_ERROR, 'Upload options are invalid', details),
        400
      );
    }

    const metadata = parsed.data;

    // ── Generate identifiers ──────────────────────────────────────────────────
    const token = generateShareToken();
    const objectKey = generateObjectKey();
    const sanitizedFilename = sanitizeFilename(metadata.filename);
    // Capture a single reference timestamp so that `uploaded_at` (persisted to
    // the DB explicitly) and `expires_at` share the same origin. Using the DB's
    // DEFAULT now() for uploaded_at while computing expires_at from the app
    // clock can cause a clock-skew violation of the
    // `files_expires_at_window_chk` constraint when the DB clock trails the
    // app clock by even a millisecond.
    const uploadedAt = new Date();
    // Always enforce a maximum lifetime. If the uploader did not specify an
    // expiration, default to MAX_EXPIRATION_DAYS (30 d) so no file lives forever.
    const expiresAt = metadata.expiresAt
      ? new Date(metadata.expiresAt)
      : getMaxExpirationDate(uploadedAt);

    logger.info('Upload started', {
      event: 'upload.created',
      requestId,
      actor: 'anonymous',
      entity: { type: 'file', id: token },
      objectKey,
      mimeType: metadata.mimeType,
      sizeBytes: metadata.sizeBytes,
      oneTime: metadata.oneTime,
      allowPreview: metadata.allowPreview,
      expiresAt: expiresAt.toISOString()
    });

    // ── Persist pending record ────────────────────────────────────────────────
    // Insert in `pending_upload` state before touching storage. If the process
    // crashes after this point, the reconciler will find the orphaned record.
    let fileId: string;
    try {
      const [record] = await resolveDb()
        .insert(files)
        .values({
          token,
          objectKey,
          originalFilename: metadata.filename,
          sanitizedFilename,
          mimeType: metadata.mimeType,
          sizeBytes: metadata.sizeBytes,
          status: 'pending_upload',
          allowPreview: metadata.allowPreview,
          oneTimeDownload: metadata.oneTime,
          uploadedAt,
          expiresAt
        })
        .returning({ id: files.id });

      if (!record) {
        throw new Error('DB insert returned no record');
      }

      fileId = record.id;
    } catch (err) {
      logger.error('Upload failed: could not persist metadata record', {
        event: 'upload_storage_failed',
        requestId,
        actor: 'anonymous',
        entity: { type: 'file', id: token },
        outcome: 'failure',
        error: err instanceof Error ? err.message : String(err),
        cause: err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined
      });
      return c.json(
        errorBody(API_ERROR_CODES.INTERNAL_ERROR, 'Upload failed due to an internal error'),
        500
      );
    }

    // ── Write object to storage ───────────────────────────────────────────────
    logger.info('Storage upload started', {
      event: 'upload_storage_started',
      requestId,
      actor: 'anonymous',
      entity: { type: 'file', id: token },
      objectKey,
      sizeBytes: metadata.sizeBytes
    });

    try {
      await resolveStorage.putConfirmed({
        key: objectKey,
        body: await resolveStorageBody(fileField),
        contentType: metadata.mimeType,
        contentLength: metadata.sizeBytes,
        contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(sanitizedFilename)}`
      });
    } catch (err) {
      // The storage layer now owns both the write and the post-write
      // confirmation semantics. If either step fails, compensate by deleting
      // the pending DB record so no stale metadata points at a missing object.
      logger.error('Storage upload failed — triggering compensation', {
        event: 'upload_storage_failed',
        requestId,
        actor: 'anonymous',
        entity: { type: 'file', id: token },
        outcome: 'failure',
        objectKey,
        error: err instanceof Error ? err.message : String(err),
        ...storageErrorContext(err)
      });

      try {
        await resolveDb().delete(files).where(eq(files.id, fileId));
        // Compensation succeeded: pending record removed.
        logger.info('Compensation triggered', {
          event: 'upload_compensation_triggered',
          requestId,
          actor: 'anonymous',
          entity: { type: 'file', id: token },
          outcome: 'success',
          fileId
        });
      } catch (cleanupErr) {
        // Best-effort; reconciler handles the stranded pending record.
        logger.error('Compensation failed: pending record may remain', {
          event: 'upload_compensation_triggered',
          requestId,
          actor: 'anonymous',
          entity: { type: 'file', id: token },
          outcome: 'failure',
          fileId,
          error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)
        });
      }

      return c.json(
        errorBody(API_ERROR_CODES.INTERNAL_ERROR, 'Upload failed: storage unavailable'),
        500
      );
    }

    logger.info('Storage upload succeeded', {
      event: 'upload_storage_succeeded',
      requestId,
      actor: 'anonymous',
      entity: { type: 'file', id: token },
      objectKey
    });

    // ── Promote to active ─────────────────────────────────────────────────────
    // Only after both DB record and storage object are confirmed consistent.
    const activatedAt = new Date();
    const expiredDuringActivation = expiresAt <= activatedAt;
    let activatedRecord: Array<{ id: string }>;
    try {
      activatedRecord = await resolveDb()
        .update(files)
        .set({
          status: expiredDuringActivation ? 'expired' : 'active',
          activatedAt
        })
        .where(eq(files.id, fileId))
        .returning({ id: files.id });
    } catch (err) {
      // Object is in storage but record is stuck in `pending_upload`.
      // The reconciler (Module 5) detects this pattern and will promote it.
      // Do NOT delete the storage object — data is safe.
      logger.error('Activation failed: record stuck in pending_upload — reconciler will resolve', {
        event: 'upload_activated',
        requestId,
        actor: 'anonymous',
        entity: { type: 'file', id: token },
        outcome: 'failure',
        fileId,
        objectKey,
        error: err instanceof Error ? err.message : String(err)
      });
      return c.json(
        errorBody(API_ERROR_CODES.INTERNAL_ERROR, 'Upload failed: activation error'),
        500
      );
    }

    if (activatedRecord.length === 0) {
      logger.error(
        'Activation failed: record disappeared before promotion — triggering compensation',
        {
          event: 'upload_activated',
          requestId,
          actor: 'anonymous',
          entity: { type: 'file', id: token },
          outcome: 'failure',
          fileId,
          objectKey,
          reason: 'activation_record_missing'
        }
      );

      try {
        await resolveStorage.delete(objectKey);
        logger.info('Compensation triggered', {
          event: 'upload_compensation_triggered',
          requestId,
          actor: 'anonymous',
          entity: { type: 'file', id: token },
          outcome: 'success',
          fileId,
          objectKey,
          reason: 'activation_record_missing',
          compensationTarget: 'storage_object'
        });
      } catch (cleanupErr) {
        logger.error('Compensation failed: orphaned object may remain after activation race', {
          event: 'upload_compensation_triggered',
          requestId,
          actor: 'anonymous',
          entity: { type: 'file', id: token },
          outcome: 'failure',
          fileId,
          objectKey,
          reason: 'activation_record_missing',
          compensationTarget: 'storage_object',
          error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
          ...storageErrorContext(cleanupErr)
        });
      }

      return c.json(
        errorBody(API_ERROR_CODES.INTERNAL_ERROR, 'Upload failed: activation error'),
        500
      );
    }

    logger.info('Upload activated', {
      event: 'upload_activated',
      requestId,
      actor: 'anonymous',
      entity: { type: 'file', id: token },
      outcome: 'success',
      fileId,
      objectKey,
      status: expiredDuringActivation ? 'expired' : 'active'
    });

    // ── Schedule lifecycle follow-up ──────────────────────────────────────────
    // Non-fatal: if enqueueing fails, the hourly reconciler will catch the
    // missed expiration or cleanup. The reconciler is the second layer of
    // correctness.
    if (expiredDuringActivation) {
      try {
        await resolveEnqueueCleanupFile(fileId, objectKey);
      } catch (err) {
        logger.warn('Upload: failed to enqueue cleanup for already-expired activation', {
          event: 'upload_activated',
          requestId,
          actor: 'anonymous',
          entity: { type: 'file', id: token },
          outcome: 'success',
          fileId,
          reason: 'activation_expired_cleanup_enqueue_failed',
          error: err instanceof Error ? err.message : String(err)
        });
      }
    } else {
      const delayMs = expiresAt.getTime() - activatedAt.getTime();

      if (delayMs > 0) {
        try {
          await resolveEnqueueExpireFile(fileId, delayMs);
        } catch (err) {
          logger.warn('Upload: failed to enqueue expire-file job — reconciler will handle', {
            event: 'upload_activated',
            requestId,
            actor: 'anonymous',
            entity: { type: 'file', id: token },
            outcome: 'success',
            fileId,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
    }

    // ── Return share link ─────────────────────────────────────────────────────
    const baseUrl = appConfig.baseUrl();
    const shareUrl = `${baseUrl}/share/${token}`;

    return c.json(
      {
        ok: true as const,
        data: {
          shareToken: token,
          shareUrl,
          expiresAt: expiresAt.toISOString()
        }
      },
      201
    );
  });

  return router;
}

export type { UploadRouterDeps } from './types';
export const uploadRouter = createUploadRouter();
