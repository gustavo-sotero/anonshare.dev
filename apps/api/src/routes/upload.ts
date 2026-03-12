import { API_ERROR_CODES, uploadRequestSchema } from '@anonshare/contracts';
import { MAX_FILE_SIZE_BYTES } from '@anonshare/domain';
import { app as appConfig } from '@anonshare/infrastructure/config';
import { createDb } from '@anonshare/infrastructure/db';
import { files } from '@anonshare/infrastructure/db/schema';
import { logger } from '@anonshare/infrastructure/logger';
import { StorageError, storageAdapter } from '@anonshare/infrastructure/storage';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { enqueueExpireFileJob } from '../queues';

// ─── Lazy DB singleton ────────────────────────────────────────────────────────
// Defer initialisation to first use so that importing this module in tests
// (where DATABASE_URL is not set) does not fail at module load time.
// In production, validateApiEnv() has already been called before any request
// reaches this handler, so the env is guaranteed to be present.
let _db: ReturnType<typeof createDb> | null = null;

function getDb() {
  if (!_db) {
    _db = createDb();
  }
  return _db;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically secure URL-safe share token.
 * 18 random bytes → 24 base64url characters (144 bits of entropy).
 * Matches SHARE_TOKEN_PATTERN /^[A-Za-z0-9_-]+$/ and DB constraint (16–64 chars).
 */
function generateShareToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString('base64url');
}

/**
 * Generate an opaque internal object key.
 * Never exposed in URLs — used only for storage lookups.
 */
function generateObjectKey(): string {
  return `objects/${crypto.randomUUID()}`;
}

/**
 * Sanitize a filename for safe public display.
 * Removes path separators, C0/DEL control characters, and leading dots.
 * Falls back to 'file' if the result would be empty.
 */
function sanitizeFilename(raw: string): string {
  const sanitized = Array.from(raw)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      // Drop path separators and control characters (U+0000–U+001F, U+007F DEL)
      return ch !== '/' && ch !== '\\' && code > 0x1f && code !== 0x7f;
    })
    .join('')
    .replace(/^\.+/, '_') // leading dots (hidden-file prevention)
    .trim()
    .slice(0, 255);
  return sanitized || 'file';
}

function errorBody(code: string, message: string, details?: Record<string, string>) {
  return { ok: false as const, error: { code, message, ...(details ? { details } : {}) } };
}

type UploadStorage = Pick<typeof storageAdapter, 'put' | 'head' | 'delete'>;

const STORAGE_CONFIRMATION_ATTEMPTS = 3;
const STORAGE_CONFIRMATION_RETRY_DELAY_MS = 250;

function storageErrorContext(err: unknown): Record<string, StorageError['kind']> | undefined {
  if (!(err instanceof StorageError)) {
    return undefined;
  }

  return { storageErrorKind: err.kind };
}

async function confirmStoredObject(
  storage: UploadStorage,
  key: string,
  expectedSizeBytes: number
): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= STORAGE_CONFIRMATION_ATTEMPTS; attempt += 1) {
    try {
      const storedObject = await storage.head(key);

      if (!storedObject) {
        throw new Error('Storage confirmation returned no object metadata');
      }

      if (storedObject.contentLength !== expectedSizeBytes) {
        throw new Error(
          `Storage confirmation size mismatch: expected ${expectedSizeBytes}, got ${storedObject.contentLength}`
        );
      }

      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < STORAGE_CONFIRMATION_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, STORAGE_CONFIRMATION_RETRY_DELAY_MS));
      }
    }
  }

  throw lastError ?? new Error('Storage confirmation failed');
}

// ─── Router ───────────────────────────────────────────────────────────────────

export type UploadRouterDeps = {
  /** Override the default lazy DB singleton. Useful in tests. */
  getDb?: () => ReturnType<typeof createDb>;
  /** Override the default storage adapter. Useful in tests. */
  storage?: UploadStorage;
  /**
   * Override the default job enqueue function. Useful in tests.
   * Receives the file UUID and the delay in ms from now.
   * Non-fatal: if omitted or if it throws, the reconciler will catch missed expirations.
   */
  enqueueExpireFile?: (fileId: string, delayMs: number) => Promise<void>;
};

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

  const router = new Hono();

  /**
   * POST /upload
   *
   * Accepts multipart/form-data with the following fields:
   *   file        — the binary file (required)
   *   oneTime     — "true" | "false"  (default "false")
   *   allowPreview — "true" | "false" (default "false")
   *   expiresAt   — ISO-8601 datetime string, or empty string for no expiration
   *
   * Lifecycle:
   *   1. Validate metadata and file size.
   *   2. Insert a `pending_upload` record so the reconciler can detect partial failures.
   *   3. Write the file object to storage.
   *   4. Confirm the object is readable through storage metadata.
   *   5. Promote the record to `active`.
   *   On any storage failure, delete the pending record (compensation).
   *   On activation failure the record stays as `pending_upload`;
   *   the reconciler will promote it when it detects the live storage object.
   */
  router.post('/', async (c) => {
    const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();

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
    const expiresAt = metadata.expiresAt ? new Date(metadata.expiresAt) : null;

    logger.info('Upload started', {
      event: 'upload_created',
      requestId,
      actor: 'anonymous',
      entity: { type: 'file', id: token },
      objectKey,
      mimeType: metadata.mimeType,
      sizeBytes: metadata.sizeBytes,
      oneTime: metadata.oneTime,
      allowPreview: metadata.allowPreview,
      expiresAt: expiresAt?.toISOString() ?? null
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
        error: err instanceof Error ? err.message : String(err)
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
      await resolveStorage.put({
        key: objectKey,
        body: fileField.stream(),
        contentType: metadata.mimeType,
        contentLength: metadata.sizeBytes
      });
    } catch (err) {
      // Compensate: remove the pending DB record so that no stale metadata
      // is left pointing to a non-existent object. If the DELETE also fails,
      // the reconciler will detect the pending_upload record with no storage
      // object and clean it up.
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

    try {
      await confirmStoredObject(resolveStorage, objectKey, metadata.sizeBytes);
    } catch (err) {
      logger.error('Storage upload could not be confirmed — record left pending for reconciler', {
        event: 'upload_storage_failed',
        requestId,
        actor: 'anonymous',
        entity: { type: 'file', id: token },
        outcome: 'failure',
        objectKey,
        error: err instanceof Error ? err.message : String(err),
        reason: 'storage_confirmation_failed',
        ...storageErrorContext(err)
      });

      return c.json(
        errorBody(API_ERROR_CODES.INTERNAL_ERROR, 'Upload failed: storage confirmation error'),
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
    let activatedRecord: Array<{ id: string }>;
    try {
      activatedRecord = await resolveDb()
        .update(files)
        .set({ status: 'active', activatedAt: new Date() })
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
      objectKey
    });

    // ── Schedule expiration job if applicable ─────────────────────────────────
    // Non-fatal: if enqueueing fails, the hourly reconciler will catch the
    // missed expiration. The reconciler is the second layer of correctness.
    if (expiresAt) {
      const delayMs = expiresAt.getTime() - Date.now();
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
          expiresAt: expiresAt?.toISOString() ?? null
        }
      },
      201
    );
  });

  return router;
}

export const uploadRouter = createUploadRouter();
