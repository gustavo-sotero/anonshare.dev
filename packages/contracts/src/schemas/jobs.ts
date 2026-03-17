import { z } from 'zod';

/**
 * Canonical queue names shared between job producers (API) and consumers (worker).
 * Keeping them here prevents string drift between processes.
 */
export const QUEUE_EXPIRE_FILE = 'expire-file';
export const QUEUE_CLEANUP_FILE = 'cleanup-file';
export const QUEUE_RECONCILE = 'reconcile';

/**
 * Lifecycle jobs should keep a bounded history for operational forensics
 * while avoiding unbounded Redis growth.
 */
export const LIFECYCLE_JOB_RETENTION = {
  removeOnComplete: 500,
  removeOnFail: 1_000
} as const;

/**
 * Periodic reconcile runs should retry quickly on transient failures instead of
 * waiting for the next hourly scheduler tick.
 */
export const RECONCILE_JOB_ATTEMPTS = 3;

/**
 * Exponential backoff base delay for recurring reconcile jobs.
 */
export const RECONCILE_JOB_BACKOFF_DELAY_MS = 5_000;

/**
 * Default lifetime for one-time download presigned URLs.
 * Shared so API delivery and cleanup delay stay aligned.
 */
export const DOWNLOAD_URL_EXPIRY_SECONDS = 15 * 60;

/**
 * Extra grace period applied before one-time cleanup to account for
 * client/network jitter near URL expiration.
 */
export const DOWNLOAD_URL_EXPIRY_GRACE_SECONDS = 60;

/**
 * One-time downloads are delivered through a short-lived presigned URL.
 * Cleanup must wait until that delivery window has elapsed so the worker does
 * not delete the object before the recipient can actually fetch it.
 */
export const ONE_TIME_DOWNLOAD_CLEANUP_DELAY_MS =
  (DOWNLOAD_URL_EXPIRY_SECONDS + DOWNLOAD_URL_EXPIRY_GRACE_SECONDS) * 1_000;

/**
 * Minimal job payload schemas shared between the API (job producers) and the
 * worker (job consumers). Payloads are intentionally small to avoid coupling
 * the worker to the full DB model — the worker re-fetches what it needs.
 */

export const expireFileJobSchema = z.object({
  fileId: z.string().uuid()
});

export type ExpireFileJobPayload = z.infer<typeof expireFileJobSchema>;

export const cleanupFileJobSchema = z.object({
  fileId: z.string().uuid(),
  objectKey: z.string().min(1)
});

export type CleanupFileJobPayload = z.infer<typeof cleanupFileJobSchema>;

export const autoHideFileJobSchema = z.object({
  fileId: z.string().uuid()
});

export type AutoHideFileJobPayload = z.infer<typeof autoHideFileJobSchema>;

export const reconcileJobSchema = z.object({
  /**
   * ISO-8601 datetime; the reconciler will examine records older than this
   * threshold. Defaults to the time the job was enqueued when omitted.
   */
  olderThan: z.iso.datetime().optional()
});

export type ReconcileJobPayload = z.infer<typeof reconcileJobSchema>;
