import {
  type AdminAnomaliesResponse,
  type AdminDownloadListResponse,
  type AdminFileDetailResponse,
  type AdminFileListResponse,
  type AdminLifecycleStatsResponse,
  type AdminOverviewResponse,
  type AdminReportListResponse,
  type AdminReportSummary,
  type AdminSession,
  type AdminSessionResponse,
  adminAnomaliesResponseSchema,
  adminDownloadListResponseSchema,
  adminFileDetailResponseSchema,
  adminFileListResponseSchema,
  adminLifecycleStatsResponseSchema,
  adminOverviewResponseSchema,
  adminReportListResponseSchema,
  adminSessionResponseSchema,
  type OperationalAnomalySummary
} from '@anonshare/contracts';
import { type AdminAccessError, createAdminAccessError } from '~/admin/access';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AdminTab =
  | 'overview'
  | 'files'
  | 'reports'
  | 'downloads'
  | 'storage'
  | 'queues'
  | 'anomalies';

export type DashboardData = {
  session: AdminSession;
  stats: AdminLifecycleStatsResponse;
  overview: AdminOverviewResponse;
  anomalies: OperationalAnomalySummary[];
  reports: AdminReportSummary[];
  reportsTotal: number;
  refreshedAt: string;
};

export type DashboardState =
  | { kind: 'loading' }
  | { kind: 'unauthenticated'; error?: string }
  | { kind: 'error'; message: string }
  | ({ kind: 'ready' } & DashboardData);

export type OnAdminAccessLost = (error: AdminAccessError) => void;

export type AdminLogoutResult =
  | { ok: true }
  | {
      ok: false;
      message: string;
    };

// ─── Constants ───────────────────────────────────────────────────────────────

export const REPORT_PAGE_SIZE = 20;
export const FILE_PAGE_SIZE = 20;
export const DOWNLOAD_PAGE_SIZE = 20;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function parseJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function extractErrorMessage(body: unknown, fallback: string): string {
  if (typeof body !== 'object' || body === null) {
    return fallback;
  }

  if ('message' in body && typeof (body as { message: unknown }).message === 'string') {
    return (body as { message: string }).message;
  }

  if (
    'error' in body &&
    typeof (body as { error: unknown }).error === 'object' &&
    (body as { error: Record<string, unknown> }).error !== null &&
    typeof (body as { error: { message?: unknown } }).error.message === 'string'
  ) {
    return (body as { error: { message: string } }).error.message;
  }

  return fallback;
}

// ─── Transport ───────────────────────────────────────────────────────────────

export async function fetchAdminJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    signal: signal ?? null
  });
  const body = await parseJsonBody(response);

  if (response.status === 401 || response.status === 403) {
    throw createAdminAccessError(response.status, body);
  }

  if (!response.ok) {
    const message = extractErrorMessage(body, `Request failed with status ${response.status}.`);
    throw new Error(message);
  }

  return body;
}

export async function postAdminJson(
  url: string,
  data: unknown,
  signal?: AbortSignal
): Promise<{ ok: boolean; body: unknown; status: number }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json'
    },
    credentials: 'same-origin',
    body: JSON.stringify(data),
    signal: signal ?? null
  });
  const body = await parseJsonBody(response);

  if (response.status === 401 || response.status === 403) {
    throw createAdminAccessError(response.status, body);
  }

  return { ok: response.ok, body, status: response.status };
}

export async function logoutAdmin(signal?: AbortSignal): Promise<AdminLogoutResult> {
  try {
    const result = await postAdminJson('/api/admin/auth/logout', {}, signal);

    if (result.ok) {
      return { ok: true };
    }

    return {
      ok: false,
      message: extractErrorMessage(result.body, 'Server logout could not be confirmed.')
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Server logout could not be confirmed.'
    };
  }
}

// ─── Data fetchers ───────────────────────────────────────────────────────────

export async function fetchAdminSession(signal?: AbortSignal): Promise<AdminSessionResponse> {
  const body = await fetchAdminJson('/api/admin/session', signal);
  const parsed = adminSessionResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('Admin session response validation failed.');
  return parsed.data;
}

export async function fetchAdminStats(signal?: AbortSignal): Promise<AdminLifecycleStatsResponse> {
  const body = await fetchAdminJson('/api/admin/stats', signal);
  const parsed = adminLifecycleStatsResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('Admin stats response validation failed.');
  return parsed.data;
}

export async function fetchAdminOverview(signal?: AbortSignal): Promise<AdminOverviewResponse> {
  const body = await fetchAdminJson('/api/admin/overview', signal);
  const parsed = adminOverviewResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('Admin overview response validation failed.');
  return parsed.data;
}

export async function fetchAdminAnomalies(signal?: AbortSignal): Promise<AdminAnomaliesResponse> {
  const body = await fetchAdminJson('/api/admin/anomalies?limit=20', signal);
  const parsed = adminAnomaliesResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('Admin anomalies response validation failed.');
  return parsed.data;
}

export async function fetchAdminReports(
  status: string,
  page: number,
  reason: string | null,
  urgency: string | null,
  signal?: AbortSignal
): Promise<AdminReportListResponse> {
  const params = new URLSearchParams({
    status,
    page: String(page),
    pageSize: String(REPORT_PAGE_SIZE)
  });
  if (reason) params.set('reason', reason);
  if (urgency) params.set('urgency', urgency);
  const body = await fetchAdminJson(`/api/admin/reports?${params.toString()}`, signal);
  const parsed = adminReportListResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('Admin reports response validation failed.');
  return parsed.data;
}

export async function fetchAdminFiles(
  status: string | null,
  policy: string | null,
  sortBy: string,
  uploadedWithinDays: number | null,
  minReportCount: number | null,
  page: number,
  signal?: AbortSignal
): Promise<AdminFileListResponse> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(FILE_PAGE_SIZE) });
  if (status) params.set('status', status);
  if (policy) params.set('policy', policy);
  params.set('sortBy', sortBy);
  if (uploadedWithinDays !== null) params.set('uploadedWithinDays', String(uploadedWithinDays));
  if (minReportCount !== null) params.set('minReportCount', String(minReportCount));
  const body = await fetchAdminJson(`/api/admin/files?${params.toString()}`, signal);
  const parsed = adminFileListResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('Admin files response validation failed.');
  return parsed.data;
}

export async function fetchAdminFileDetail(
  fileId: string,
  signal?: AbortSignal
): Promise<AdminFileDetailResponse> {
  const body = await fetchAdminJson(`/api/admin/files/${encodeURIComponent(fileId)}`, signal);
  const parsed = adminFileDetailResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('Admin file detail response validation failed.');
  return parsed.data;
}

export async function fetchAdminDownloads(
  fileId: string | null,
  page: number,
  signal?: AbortSignal
): Promise<AdminDownloadListResponse> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(DOWNLOAD_PAGE_SIZE)
  });
  if (fileId) params.set('fileId', fileId);
  const body = await fetchAdminJson(`/api/admin/downloads?${params.toString()}`, signal);
  const parsed = adminDownloadListResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('Admin downloads response validation failed.');
  return parsed.data;
}

export async function loadDashboardState(signal?: AbortSignal): Promise<DashboardState> {
  const sessionResponse = await fetchAdminSession(signal);

  if (!sessionResponse.authenticated || !sessionResponse.session) {
    return { kind: 'unauthenticated' };
  }

  const [statsResponse, overviewResponse, anomaliesResponse, reportsResponse] = await Promise.all([
    fetchAdminStats(signal),
    fetchAdminOverview(signal),
    fetchAdminAnomalies(signal),
    fetchAdminReports('pending', 1, null, null, signal)
  ]);

  return {
    kind: 'ready',
    session: sessionResponse.session,
    stats: statsResponse,
    overview: overviewResponse,
    anomalies: anomaliesResponse.anomalies,
    reports: reportsResponse.reports,
    reportsTotal: reportsResponse.total,
    refreshedAt: new Date().toISOString()
  };
}
