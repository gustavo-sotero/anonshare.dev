import type { AdminTab } from './transport';

const ADMIN_TAB_VALUES: Set<AdminTab> = new Set([
  'overview',
  'files',
  'reports',
  'downloads',
  'storage',
  'queues',
  'anomalies'
]);

export type AdminSearchParams = {
  error?: string;
  tab?: AdminTab;
  fileId?: string;
};

/**
 * Parse and validate admin route search params.
 * Only recognized keys are kept; all others are silently discarded.
 */
export function parseAdminSearchParams(search: Record<string, unknown>): AdminSearchParams {
  const params: AdminSearchParams = {};
  if (typeof search.error === 'string') params.error = search.error;
  if (typeof search.tab === 'string' && ADMIN_TAB_VALUES.has(search.tab as AdminTab)) {
    params.tab = search.tab as AdminTab;
  }
  if (typeof search.fileId === 'string' && search.fileId.length > 0) {
    params.fileId = search.fileId;
  }
  return params;
}
