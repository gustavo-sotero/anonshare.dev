import { StorageError } from '@anonshare/infrastructure/storage';

/**
 * Generate a cryptographically secure URL-safe share token.
 * 18 random bytes → 24 base64url characters (144 bits of entropy).
 * Matches SHARE_TOKEN_PATTERN /^[A-Za-z0-9_-]+$/ and DB constraint (16–64 chars).
 */
export function generateShareToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString('base64url');
}

/**
 * Generate an opaque internal object key.
 * Never exposed in URLs — used only for storage lookups.
 */
export function generateObjectKey(): string {
  return `objects/${crypto.randomUUID()}`;
}

/**
 * Sanitize a filename for safe public display.
 * Removes path separators, C0/DEL control characters, and leading dots.
 * Falls back to 'file' if the result would be empty.
 */
export function sanitizeFilename(raw: string): string {
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

export function storageErrorContext(
  err: unknown
): Record<string, StorageError['kind']> | undefined {
  if (!(err instanceof StorageError)) {
    return undefined;
  }

  return { storageErrorKind: err.kind };
}
