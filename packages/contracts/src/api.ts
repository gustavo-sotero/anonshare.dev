// ─── Upload ───────────────────────────────────────────────────────────────────
// Runtime-validated shapes are in ./schemas/upload.ts; these are the canonical types.

export type { UploadRequest, UploadResponse } from './schemas/upload';

// ─── Share page ───────────────────────────────────────────────────────────────

export type { FileMetaResponse, ShareTokenParams } from './schemas/share';

// ─── Download ────────────────────────────────────────────────────────────────

export type {
  BlockedAccessResponse,
  DownloadUrlResponse,
  PreviewUrlResponse
} from './schemas/share';

// ─── Report ───────────────────────────────────────────────────────────────────
// Runtime-validated shapes are in ./schemas/report.ts

export type { ReportRequest, ReportResponse } from './schemas/report';

// ─── Error envelope ──────────────────────────────────────────────────────────
// Defined in ./errors.ts alongside the error code registry

export type {
  ApiEnvelope,
  ApiError,
  ApiErrorCode,
  ApiErrorEnvelope,
  ApiSuccessEnvelope
} from './errors';

// ─── Admin auth/session/moderation ───────────────────────────────────────────

export type {
  AccessDeniedResponse,
  AdminLoginCallback,
  AdminLoginStartResponse,
  AdminSession,
  AdminSessionResponse,
  ModerationAction,
  ResolveReportAction
} from './schemas/admin';

// ─── Job payloads (shared between API and worker) ────────────────────────────
// Runtime-validated shapes are in ./schemas/jobs.ts

export type {
  AutoHideFileJobPayload,
  CleanupFileJobPayload,
  ExpireFileJobPayload,
  ReconcileJobPayload
} from './schemas/jobs';
