import { z } from 'zod';

/**
 * Canonical queue names shared between job producers (API) and consumers (worker).
 * Keeping them here prevents string drift between processes.
 */
export const QUEUE_EXPIRE_FILE = 'expire-file';
export const QUEUE_CLEANUP_FILE = 'cleanup-file';
export const QUEUE_RECONCILE = 'reconcile';

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
