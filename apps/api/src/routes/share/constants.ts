// Per-IP rate-limit window for share metadata, download, and preview endpoints.
export const SHARE_DOWNLOAD_RATE_WINDOW_SECONDS = 60;

// Additional per-token guard to contain abuse focused on a single public link.
export const SHARE_TOKEN_RATE_LIMIT = 12;
export const SHARE_TOKEN_RATE_WINDOW_SECONDS = 60;

// How long a presigned preview URL remains valid.
export const PREVIEW_URL_EXPIRY_SECONDS = 3600; // 1 hour
