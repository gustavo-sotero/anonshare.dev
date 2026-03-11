export type ReportReason = 'illegal_content' | 'copyright_violation' | 'malware' | 'spam' | 'other';

export type ReportStatus = 'pending' | 'resolved' | 'dismissed';

export const REPORT_AUTO_HIDE_THRESHOLD_DEFAULT = 3;

export const MAX_FILE_SIZE_BYTES = 256 * 1024 * 1024; // 256 MB
export const MAX_EXPIRATION_DAYS = 30;

export const PREVIEW_ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'application/pdf',
  'text/plain',
  'text/markdown'
]);

export function isPreviewSupported(mimeType: string): boolean {
  return PREVIEW_ALLOWED_MIME_TYPES.has(mimeType);
}

// One-time download files cannot have preview enabled — PRD §4
export function validateUploadOptions(opts: { oneTime: boolean; allowPreview: boolean }): {
  valid: boolean;
  reason?: string;
} {
  if (opts.oneTime && opts.allowPreview) {
    return {
      valid: false,
      reason: 'Preview cannot be enabled for one-time download files.'
    };
  }
  return { valid: true };
}
