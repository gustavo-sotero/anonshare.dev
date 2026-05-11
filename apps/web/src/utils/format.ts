/**
 * Shared formatting utilities for the web application.
 *
 * This module is the single source of truth for byte/number formatting used
 * across the upload home page, share page, and admin dashboard.
 */

// ─── Byte formatting ──────────────────────────────────────────────────────────

/**
 * Formats a byte count as a human-readable string with up to one decimal place.
 * Uses IEC binary prefixes (KB = 1024 B, MB = 1024 KB, …).
 *
 * @example formatBytes(1536)   // "1.5 KB"
 * @example formatBytes(2097152) // "2.0 MB"
 */
export function formatBytes(value: number): string {
  if (value < 1024) return `${new Intl.NumberFormat().format(value)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = -1;
  do {
    size /= 1024;
    unitIndex += 1;
  } while (size >= 1024 && unitIndex < units.length - 1);
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: size >= 100 ? 0 : 1 }).format(size)} ${units[unitIndex]}`;
}
