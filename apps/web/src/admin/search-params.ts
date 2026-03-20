export type AdminSearchParams = { error?: string };

/**
 * Parse and validate admin route search params.
 * Only `error` (string) is recognized; all other keys are silently discarded.
 */
export function parseAdminSearchParams(search: Record<string, unknown>): AdminSearchParams {
  const params: AdminSearchParams = {};
  if (typeof search.error === 'string') params.error = search.error;
  return params;
}
