import type { FileStatus, ReportReason } from '@anonshare/domain';

// ─── Upload ───────────────────────────────────────────────────────────────────

export interface UploadRequest {
  /** Display name for the file (sanitized, not the raw filename). */
  filename: string;
  mimeType: string;
  sizeBytes: number;
  oneTime: boolean;
  allowPreview: boolean;
  /** ISO-8601 datetime string, or null for no expiration. */
  expiresAt: string | null;
}

export interface UploadResponse {
  shareToken: string;
  shareUrl: string;
  expiresAt: string | null;
}

// ─── Share page ───────────────────────────────────────────────────────────────

export interface FileMetaResponse {
  shareToken: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: FileStatus;
  oneTime: boolean;
  allowPreview: boolean;
  expiresAt: string | null;
  createdAt: string;
}

// ─── Report ───────────────────────────────────────────────────────────────────

export interface ReportRequest {
  reason: ReportReason;
  message?: string;
}

export interface ReportResponse {
  id: string;
  createdAt: string;
}

// ─── Error envelope ──────────────────────────────────────────────────────────

export interface ApiError {
  code: string;
  message: string;
  /** Field-level validation errors when applicable (keyed by field path). */
  details?: Record<string, string>;
}

// ─── Job payloads (shared between API and worker) ────────────────────────────

export interface ExpireFileJobPayload {
  fileId: string;
}

export interface CleanupFileJobPayload {
  fileId: string;
  objectKey: string;
}

export interface ReconcileJobPayload {
  /** ISO-8601 datetime; jobs older than this threshold are considered stale. */
  olderThan?: string;
}
