export const REPORT_REASON_VALUES = [
  'illegal_content',
  'copyright_violation',
  'malware',
  'spam',
  'other'
] as const;

export type ReportReason = (typeof REPORT_REASON_VALUES)[number];

export const REPORT_STATUS_VALUES = ['pending', 'resolved', 'dismissed'] as const;

export type ReportStatus = (typeof REPORT_STATUS_VALUES)[number];

export const REPORT_AUTO_HIDE_THRESHOLD_DEFAULT = 3;

export const MAX_FILE_SIZE_BYTES = 256 * 1024 * 1024; // 256 MB
export const MAX_EXPIRATION_DAYS = 30;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

export type UploadPolicyValidationIssue = {
  path: 'allowPreview' | 'expiresAt';
  message: string;
};

export type UploadPolicy = {
  oneTime: boolean;
  allowPreview: boolean;
  expiresAt?: Date | null;
};

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

export function normalizeMimeType(mimeType: string): string {
  const segments = mimeType
    .trim()
    .toLowerCase()
    .split(';')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment, index) => (index === 0 ? segment : segment.replace(/\s*=\s*/g, '=')));

  return segments.join(';');
}

export function isPreviewSupported(mimeType: string): boolean {
  const [baseMimeType] = normalizeMimeType(mimeType).split(';');
  return baseMimeType ? PREVIEW_ALLOWED_MIME_TYPES.has(baseMimeType) : false;
}

export function getMaxExpirationDate(from: Date = new Date()): Date {
  return new Date(from.getTime() + MAX_EXPIRATION_DAYS * DAY_IN_MS);
}

export function validateUploadPolicy(
  policy: UploadPolicy,
  now: Date = new Date()
): { valid: boolean; issues: UploadPolicyValidationIssue[] } {
  const issues: UploadPolicyValidationIssue[] = [];

  if (policy.oneTime && policy.allowPreview) {
    issues.push({
      path: 'allowPreview',
      message: 'Preview cannot be enabled for one-time download files.'
    });
  }

  if (policy.expiresAt) {
    if (policy.expiresAt.getTime() <= now.getTime()) {
      issues.push({
        path: 'expiresAt',
        message: 'Expiration must be in the future.'
      });
    }

    if (policy.expiresAt.getTime() > getMaxExpirationDate(now).getTime()) {
      issues.push({
        path: 'expiresAt',
        message: `Expiration cannot be more than ${MAX_EXPIRATION_DAYS} days from now.`
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

// One-time download files cannot have preview enabled — PRD §4
export function validateUploadOptions(opts: { oneTime: boolean; allowPreview: boolean }): {
  valid: boolean;
  reason?: string;
} {
  const result = validateUploadPolicy({
    oneTime: opts.oneTime,
    allowPreview: opts.allowPreview,
    expiresAt: null
  });

  if (!result.valid) {
    const [firstIssue] = result.issues;

    return {
      valid: false,
      reason: firstIssue ? firstIssue.message : 'Upload options are invalid.'
    };
  }

  return { valid: true };
}
