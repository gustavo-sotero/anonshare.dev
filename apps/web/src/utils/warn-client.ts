/**
 * Client-side structured warning helper.
 *
 * Routes warnings through a consistent shape so they can be identified and
 * correlated in browser devtools without raw `console.warn` calls scattered
 * across the codebase.
 *
 * In a future iteration this can be wired to a client telemetry sink if needed.
 */
export function warnClient(message: string, context?: Record<string, unknown>): void {
  console.warn('[anonshare]', message, context ?? {});
}
