import {
  apiErrorEnvelopeSchema,
  type DownloadUrlResponse,
  downloadUrlResponseSchema,
  type FileMetaResponse,
  fileMetaResponseSchema,
  type PreviewUrlResponse,
  previewUrlResponseSchema
} from '@anonshare/contracts';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ShareTransportOk<T> = { ok: true; data: T };
export type ShareTransportErr = { ok: false; status: number; code: string; message: string };
export type ShareTransportResult<T> = ShareTransportOk<T> | ShareTransportErr;

// ─── Internal helpers ─────────────────────────────────────────────────────────

type SafeParseable<T> = {
  safeParse: (data: unknown) => { success: true; data: T } | { success: false };
};

async function parseApiResponse<T>(
  res: Response,
  dataSchema: SafeParseable<T>
): Promise<ShareTransportResult<T>> {
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return {
      ok: false,
      status: res.status,
      code: 'file_unavailable',
      message: 'Invalid response from server.'
    };
  }

  if (res.ok) {
    // Extract `.data` from the success envelope `{ ok: true, data: ... }`
    // and validate it directly — avoids depending on zod in the web package.
    const dataField =
      typeof raw === 'object' && raw !== null && 'data' in raw
        ? (raw as { data: unknown }).data
        : raw;
    const parsed = dataSchema.safeParse(dataField);
    if (parsed.success) return { ok: true, data: parsed.data };
    return {
      ok: false,
      status: res.status,
      code: 'file_unavailable',
      message: 'Unexpected response format.'
    };
  }

  const errParsed = apiErrorEnvelopeSchema.safeParse(raw);
  if (errParsed.success) {
    return {
      ok: false,
      status: res.status,
      code: errParsed.data.error.code,
      message: errParsed.data.error.message
    };
  }

  return { ok: false, status: res.status, code: 'file_unavailable', message: 'Server error.' };
}

// ─── Public transport functions ───────────────────────────────────────────────

export async function fetchShareMeta(
  apiBase: string,
  token: string,
  signal?: AbortSignal
): Promise<ShareTransportResult<FileMetaResponse>> {
  const res = await fetch(`${apiBase}/share/${token}`, {
    headers: { accept: 'application/json' },
    signal: signal ?? null
  });
  return parseApiResponse(res, fileMetaResponseSchema);
}

export async function fetchDownloadUrl(
  token: string,
  signal?: AbortSignal
): Promise<ShareTransportResult<DownloadUrlResponse>> {
  const res = await fetch(`/api/share/${token}/download`, {
    headers: { accept: 'application/json' },
    signal: signal ?? null
  });
  return parseApiResponse(res, downloadUrlResponseSchema);
}

export async function fetchPreviewUrl(
  token: string,
  signal?: AbortSignal
): Promise<ShareTransportResult<PreviewUrlResponse>> {
  const res = await fetch(`/api/share/${token}/preview`, {
    headers: { accept: 'application/json' },
    signal: signal ?? null
  });
  return parseApiResponse(res, previewUrlResponseSchema);
}

export async function refreshShareAvailability(
  token: string,
  signal?: AbortSignal
): Promise<ShareTransportResult<FileMetaResponse>> {
  const res = await fetch(`/api/share/${token}`, {
    headers: { accept: 'application/json' },
    signal: signal ?? null
  });
  return parseApiResponse(res, fileMetaResponseSchema);
}

export async function submitShareReport(
  token: string,
  reason: string,
  message: string | null,
  signal?: AbortSignal
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const body: Record<string, string> = { reason };
  if (message) body['message'] = message;

  const res = await fetch(`/api/report/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    signal: signal ?? null
  });

  if (res.ok) return { ok: true };

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { ok: false, code: 'internal_error', message: 'Failed to submit. Please try again.' };
  }

  const errParsed = apiErrorEnvelopeSchema.safeParse(raw);
  if (errParsed.success) {
    return {
      ok: false,
      code: errParsed.data.error.code,
      message: errParsed.data.error.message
    };
  }

  return { ok: false, code: 'internal_error', message: 'Failed to submit. Please try again.' };
}
