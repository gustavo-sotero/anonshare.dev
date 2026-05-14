/**
 * Shared E2E test fixtures and helpers.
 *
 * API_URL points to the Hono backend. BASE_URL points to the TanStack Start web app.
 * Both are resolved from environment variables or the defaults that match the CI setup.
 */
export const API_URL = process.env.APP_API_URL ?? 'http://localhost:3001';
export const BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:3000';
export const ADMIN_STORAGE_STATE_PATH = 'playwright/.auth/admin.json';

/**
 * Bootstrap an admin session via the test-only internal endpoint.
 * Only succeeds when NODE_ENV=test (guarded server-side).
 *
 * Returns the Set-Cookie header value so callers can inject it into requests.
 */
export async function bootstrapAdminSession(): Promise<string> {
  const response = await fetch(`${API_URL}/_internal/test/session`, {
    method: 'POST'
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to bootstrap admin session: HTTP ${response.status} — ${body}`);
  }

  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) {
    throw new Error('Admin session bootstrap: no Set-Cookie header in response');
  }

  return setCookie;
}

/**
 * Upload a file through the API and return the share token.
 * Uses the same multipart POST /upload endpoint as the web UI.
 */
export async function uploadFile(options: {
  filename: string;
  content: string;
  mimeType?: string;
  oneTimeDownload?: boolean;
  expiresInMinutes?: number;
  allowPreview?: boolean;
  forwardedFor?: string;
}): Promise<{ shareToken: string; shareUrl: string; expiresAt: string }> {
  const {
    filename,
    content,
    mimeType = 'text/plain',
    oneTimeDownload = false,
    allowPreview = false,
    forwardedFor
  } = options;

  const form = new FormData();
  form.append('file', new Blob([content], { type: mimeType }), filename);
  form.append('oneTime', String(oneTimeDownload));
  form.append('allowPreview', String(allowPreview));
  if (options.expiresInMinutes) {
    form.append(
      'expiresAt',
      new Date(Date.now() + options.expiresInMinutes * 60_000).toISOString()
    );
  }

  const response = await fetch(`${API_URL}/upload`, {
    method: 'POST',
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : undefined,
    body: form
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Upload failed: HTTP ${response.status} — ${body}`);
  }

  const envelope = (await response.json()) as {
    ok: true;
    data: { shareToken: string; shareUrl: string; expiresAt: string };
  };

  return envelope.data;
}

export async function submitShareReport(options: {
  shareToken: string;
  reason: 'illegal_content' | 'copyright_violation' | 'malware' | 'spam' | 'other';
  message?: string;
  forwardedFor?: string;
}): Promise<void> {
  const response = await fetch(`${API_URL}/report/${options.shareToken}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(options.forwardedFor ? { 'x-forwarded-for': options.forwardedFor } : {})
    },
    body: JSON.stringify({
      reason: options.reason,
      ...(options.message ? { message: options.message } : {})
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Report failed: HTTP ${response.status} — ${body}`);
  }
}
