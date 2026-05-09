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

type FilesStatusFilter = '' | 'active' | 'expiring' | 'expired' | 'hidden' | 'deleted' | 'consumed';

type FilesSortBy = 'uploadedAt_desc' | 'sizeBytes_desc' | 'reportCount_desc';

type FilesPolicyFilter = '' | 'standard' | 'one_time' | 'preview_enabled';

type ReportsStatusFilter = 'pending' | 'resolved' | 'dismissed';

type ReportsReasonFilter =
  | ''
  | 'illegal_content'
  | 'copyright_violation'
  | 'malware'
  | 'spam'
  | 'other';

type ReportsUrgencyFilter = '' | 'high' | 'medium' | 'low';

export type AdminSearchParams = {
  // Navigation
  error?: string;
  tab?: AdminTab;
  fileId?: string;
  // Files tab filters and pagination
  filesPage?: number;
  filesStatus?: FilesStatusFilter;
  filesPolicy?: FilesPolicyFilter;
  filesSortBy?: FilesSortBy;
  filesDays?: number;
  filesMinReports?: number;
  // Reports tab filters and pagination
  reportsPage?: number;
  reportsStatus?: ReportsStatusFilter;
  reportsReason?: ReportsReasonFilter;
  reportsUrgency?: ReportsUrgencyFilter;
  // Downloads tab filters and pagination
  downloadsPage?: number;
  downloadsFileId?: string;
  // Storage tab pagination
  storagePage?: number;
};

/**
 * A wider update type that allows explicitly setting keys to `undefined` to
 * signal "remove this param from the URL".  Used by `onUpdateSearch` to work
 * correctly with `exactOptionalPropertyTypes`.
 */
export type AdminSearchUpdate = {
  [K in keyof AdminSearchParams]?: AdminSearchParams[K] | undefined;
};

const FILES_STATUS_VALUES = new Set<string>([
  '',
  'active',
  'expiring',
  'expired',
  'hidden',
  'deleted',
  'consumed'
]);

const FILES_POLICY_VALUES = new Set<string>(['', 'standard', 'one_time', 'preview_enabled']);
const FILES_SORT_VALUES = new Set<string>([
  'uploadedAt_desc',
  'sizeBytes_desc',
  'reportCount_desc'
]);
const REPORTS_STATUS_VALUES = new Set<string>(['pending', 'resolved', 'dismissed']);
const REPORTS_REASON_VALUES = new Set<string>([
  '',
  'illegal_content',
  'copyright_violation',
  'malware',
  'spam',
  'other'
]);
const REPORTS_URGENCY_VALUES = new Set<string>(['', 'high', 'medium', 'low']);

function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

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

  // Files tab
  const filesPage = parsePositiveInt(search.filesPage);
  if (filesPage !== undefined) params.filesPage = filesPage;

  if (typeof search.filesStatus === 'string' && FILES_STATUS_VALUES.has(search.filesStatus)) {
    params.filesStatus = search.filesStatus as FilesStatusFilter;
  }

  if (typeof search.filesPolicy === 'string' && FILES_POLICY_VALUES.has(search.filesPolicy)) {
    params.filesPolicy = search.filesPolicy as FilesPolicyFilter;
  }

  if (typeof search.filesSortBy === 'string' && FILES_SORT_VALUES.has(search.filesSortBy)) {
    params.filesSortBy = search.filesSortBy as FilesSortBy;
  }

  const filesDays = parsePositiveInt(search.filesDays);
  if (filesDays !== undefined) params.filesDays = filesDays;

  const filesMinReports = parsePositiveInt(search.filesMinReports);
  if (filesMinReports !== undefined) params.filesMinReports = filesMinReports;

  // Reports tab
  const reportsPage = parsePositiveInt(search.reportsPage);
  if (reportsPage !== undefined) params.reportsPage = reportsPage;

  if (typeof search.reportsStatus === 'string' && REPORTS_STATUS_VALUES.has(search.reportsStatus)) {
    params.reportsStatus = search.reportsStatus as ReportsStatusFilter;
  }

  if (typeof search.reportsReason === 'string' && REPORTS_REASON_VALUES.has(search.reportsReason)) {
    params.reportsReason = search.reportsReason as ReportsReasonFilter;
  }

  if (
    typeof search.reportsUrgency === 'string' &&
    REPORTS_URGENCY_VALUES.has(search.reportsUrgency)
  ) {
    params.reportsUrgency = search.reportsUrgency as ReportsUrgencyFilter;
  }

  // Downloads tab
  const downloadsPage = parsePositiveInt(search.downloadsPage);
  if (downloadsPage !== undefined) params.downloadsPage = downloadsPage;

  if (typeof search.downloadsFileId === 'string' && search.downloadsFileId.length > 0) {
    params.downloadsFileId = search.downloadsFileId;
  }

  // Storage tab
  const storagePage = parsePositiveInt(search.storagePage);
  if (storagePage !== undefined) params.storagePage = storagePage;

  return params;
}
