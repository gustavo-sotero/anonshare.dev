import { reportReasonValues } from '@anonshare/contracts';
import { isPreviewSupported } from '@anonshare/domain';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { SiteFrame } from '~/components/site-frame';
import { canReportUnavailableFile } from '~/share/reporting';

// ─── Loader result type (shared between head, loader, and component) ──────────

type FileMeta = {
  shareToken: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  oneTime: boolean;
  allowPreview: boolean;
  expiresAt: string | null;
  createdAt: string;
};

type LoaderResult =
  | { ok: true; status: 200; data: FileMeta; errorCode: null }
  | { ok: false; status: number; data: null; errorCode: string; errorMessage: string };

export function buildSharePageHead(loaderData?: LoaderResult) {
  const title =
    loaderData?.ok && loaderData.data?.filename
      ? `${loaderData.data.filename} — anonshare`
      : 'anonshare — file link';

  return {
    meta: [
      { title },
      // Share pages must never be indexed: they contain ephemeral content
      // addressed by unguessable tokens and have short lifetimes.
      { name: 'robots', content: 'noindex, nofollow' }
    ]
  };
}

export const Route = createFileRoute('/share/$token')({
  head: ({ loaderData }) => buildSharePageHead(loaderData as LoaderResult | undefined),
  loader: async ({ params }): Promise<LoaderResult> => {
    // Loader runs isomorphically — detect server vs browser context.
    // On the server during SSR, call the Hono API directly via env URL.
    // On the client during navigation, use the /api proxy path.
    const isServer = typeof window === 'undefined';
    const apiBase = isServer ? (process.env.APP_API_URL ?? 'http://localhost:3001') : '/api';

    let response: Response;
    try {
      response = await fetch(`${apiBase}/share/${params.token}`, {
        headers: { accept: 'application/json' }
      });
    } catch {
      return {
        ok: false as const,
        status: 503,
        data: null,
        errorCode: 'file_unavailable',
        errorMessage: 'This file is temporarily unavailable. Please try again in a moment.'
      };
    }

    const body = await parseJsonResponse(response);

    // Narrow to typed shapes expected by the component
    if (response.status === 200 && isOkEnvelope(body)) {
      return { ok: true as const, status: 200, data: body.data, errorCode: null };
    }

    const errorCode = isErrorEnvelope(body) ? body.error.code : 'file_unavailable';
    const errorMessage = isErrorEnvelope(body) ? body.error.message : 'This file is unavailable.';

    return {
      ok: false as const,
      status: response.status,
      data: null,
      errorCode,
      errorMessage
    };
  },
  component: SharePage
});

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// ─── Narrow helpers (cheap runtime checks for typed API bodies) ───────────────

function isOkEnvelope(body: unknown): body is { ok: true; data: FileMeta } {
  return (
    typeof body === 'object' &&
    body !== null &&
    'ok' in body &&
    (body as { ok: unknown }).ok === true &&
    'data' in body
  );
}

function isErrorEnvelope(
  body: unknown
): body is { ok: false; error: { code: string; message: string } } {
  return (
    typeof body === 'object' &&
    body !== null &&
    'ok' in body &&
    (body as { ok: unknown }).ok === false &&
    'error' in body
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function mimeLabel(mimeType: string): string {
  const parts = mimeType.split('/');
  const type = parts[0] ?? mimeType;
  const sub = parts[1];
  const base = sub ?? type;
  const clean = (base.split(';')[0] ?? base).toUpperCase();
  return clean.slice(0, 20);
}

// ─── Status badge map ─────────────────────────────────────────────────────────

type UnavailabilityInfo = { label: string; message: string };
type ReportReason = (typeof reportReasonValues)[number];

const TEXT_PREVIEW_MAX_BYTES = 64 * 1024;

const RUNTIME_UNAVAILABLE_CODES = new Set([
  'file_expired',
  'file_consumed',
  'file_hidden',
  'file_deleted',
  'file_unavailable',
  'not_found'
]);

const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  illegal_content: 'Illegal content',
  copyright_violation: 'Copyright violation',
  malware: 'Malware or phishing',
  spam: 'Spam',
  other: 'Other'
};

const UNAVAILABILITY: Record<string, UnavailabilityInfo> = {
  file_expired: {
    label: 'Expired',
    message: 'This file has expired and is no longer available for download.'
  },
  file_consumed: {
    label: 'Already downloaded',
    message: 'This one-time link has already been used. The file is no longer available.'
  },
  file_hidden: {
    label: 'Unavailable',
    message: 'This file has been flagged and is temporarily unavailable.'
  },
  file_deleted: {
    label: 'Deleted',
    message: 'This file has been deleted by the operator and cannot be retrieved.'
  },
  file_unavailable: {
    label: 'Unavailable',
    message: 'This file is not available right now.'
  },
  not_found: {
    label: 'Not found',
    message: "This link doesn't match any file we have. It may never have existed."
  }
};

const TEXT_PREVIEW_TIMEOUT_MS = 15_000;

// ─── Preview renderer ─────────────────────────────────────────────────────────

function PreviewPanel({ url, mimeType }: { url: string; mimeType: string }) {
  const base = (mimeType.split(';')[0] ?? mimeType).trim();

  if (base.startsWith('image/')) {
    return (
      <div className="preview-panel">
        <img src={url} alt="File preview" className="preview-panel__image" />
      </div>
    );
  }

  if (base.startsWith('video/')) {
    return (
      <div className="preview-panel">
        {/* biome-ignore lint/a11y/useMediaCaption: preview of uploaded content, no captions available */}
        <video src={url} controls playsInline className="preview-panel__video" />
      </div>
    );
  }

  if (base.startsWith('audio/')) {
    return (
      <div className="preview-panel">
        {/* biome-ignore lint/a11y/useMediaCaption: preview of uploaded content */}
        <audio src={url} controls className="preview-panel__audio" />
      </div>
    );
  }

  if (base === 'application/pdf') {
    return (
      <div className="preview-panel preview-panel--embed">
        <iframe src={url} title="PDF preview" className="preview-panel__iframe" />
      </div>
    );
  }

  if (base.startsWith('text/')) {
    return <TextPreview url={url} />;
  }

  return null;
}

async function readTextPreview(
  url: string,
  maxBytes: number
): Promise<{ text: string; truncated: boolean }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TEXT_PREVIEW_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error('Preview request failed');
    }

    if (!response.body) {
      const text = await response.text();
      return {
        text: text.slice(0, maxBytes),
        truncated: text.length > maxBytes
      };
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    let streamDone = false;
    let truncated = false;

    while (received < maxBytes) {
      const { done, value } = await reader.read();
      streamDone = done;

      if (done) {
        break;
      }

      if (!value || value.byteLength === 0) {
        continue;
      }

      const remaining = maxBytes - received;
      if (value.byteLength <= remaining) {
        chunks.push(value);
        received += value.byteLength;
        continue;
      }

      chunks.push(value.subarray(0, remaining));
      received += remaining;
      truncated = true;
      break;
    }

    if (!truncated && !streamDone) {
      const probe = await reader.read();
      truncated = !probe.done;
    }

    await reader.cancel().catch(() => {});

    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return {
      text: new TextDecoder().decode(bytes),
      truncated
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Preview request timed out');
    }

    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setText(null);
    setIsTruncated(false);
    setError(false);

    readTextPreview(url, TEXT_PREVIEW_MAX_BYTES)
      .then((result) => {
        if (cancelled) {
          return;
        }

        setIsTruncated(result.truncated);
        setText(result.text);
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) return <p className="preview-panel__error">Could not load text preview.</p>;
  if (text === null) return <p className="preview-panel__loading">Loading preview…</p>;

  return (
    <div className="preview-panel preview-panel--text">
      <pre className="preview-panel__pre">{text}</pre>
      {isTruncated && (
        <p className="preview-panel__loading">Preview truncated to the first 64 KB.</p>
      )}
    </div>
  );
}

type ReportPhase = 'idle' | 'submitting' | 'success' | 'error';

function PublicReportPanel({
  reportOpen,
  reportReason,
  reportMessage,
  reportPhase,
  reportError,
  onOpen,
  onReasonChange,
  onMessageChange,
  onSubmit,
  onCancel,
  copy
}: {
  reportOpen: boolean;
  reportReason: ReportReason;
  reportMessage: string;
  reportPhase: ReportPhase;
  reportError: string | null;
  onOpen: () => void;
  onReasonChange: (reason: ReportReason) => void;
  onMessageChange: (message: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  copy?: string;
}) {
  return (
    <section className="panel panel--muted">
      {reportPhase === 'success' ? (
        <p className="panel__copy report-success">
          &#x2713; Your report has been received. The operator reviews all reports.
        </p>
      ) : reportOpen ? (
        <>
          <div className="panel__row">
            <p className="panel__label">Report this file</p>
          </div>
          <div className="report-form">
            <label className="report-form__label">
              Reason
              <select
                className="report-form__select"
                value={reportReason}
                onChange={(e) => {
                  const nextReason = e.target.value;
                  if (reportReasonValues.includes(nextReason as ReportReason)) {
                    onReasonChange(nextReason as ReportReason);
                  }
                }}
                disabled={reportPhase === 'submitting'}
              >
                {reportReasonValues.map((reason) => (
                  <option key={reason} value={reason}>
                    {REPORT_REASON_LABELS[reason]}
                  </option>
                ))}
              </select>
            </label>
            <label className="report-form__label">
              Additional context <span className="report-form__optional">(optional)</span>
              <textarea
                className="report-form__textarea"
                value={reportMessage}
                onChange={(e) => onMessageChange(e.target.value.slice(0, 1000))}
                placeholder="Describe the issue briefly."
                rows={3}
                disabled={reportPhase === 'submitting'}
              />
            </label>
            {reportError && <p className="upload-error">{reportError}</p>}
            <div className="action-row">
              <button
                type="button"
                className="button-link button-link--sm"
                disabled={reportPhase === 'submitting'}
                onClick={onSubmit}
              >
                {reportPhase === 'submitting' ? 'Submitting…' : 'Submit report'}
              </button>
              <button
                type="button"
                className="button-link button-link--ghost button-link--sm"
                disabled={reportPhase === 'submitting'}
                onClick={onCancel}
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      ) : (
        <p className="panel__copy">
          {copy ?? 'If this file contains illegal or harmful content, you can '}
          <button type="button" className="inline-btn" onClick={onOpen}>
            report it
          </button>
          . Reports are reviewed by the operator.
        </p>
      )}
    </section>
  );
}

// ─── Main share page component ────────────────────────────────────────────────

function SharePage() {
  const { token } = Route.useParams();
  // Cast required: TanStack Router infers useLoaderData() as `never` when the
  // component is defined after the Route object (circular reference at definition
  // time). The explicit cast is safe — the loader always returns LoaderResult.
  const loader = Route.useLoaderData() as LoaderResult | undefined;

  // All hooks must be declared unconditionally before any early returns.
  const [downloadState, setDownloadState] = useState<'idle' | 'fetching' | 'error'>('idle');
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<'hidden' | 'loading' | 'ready' | 'error'>(
    'hidden'
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMime, setPreviewMime] = useState<string>('');
  // Track whether a one-time file has been consumed in this session
  const [consumed, setConsumed] = useState(false);
  const [runtimeUnavailable, setRuntimeUnavailable] = useState<{
    code: string;
    message: string;
  } | null>(null);
  // Report section state
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason>(reportReasonValues[0]);
  const [reportMessage, setReportMessage] = useState('');
  const [reportPhase, setReportPhase] = useState<'idle' | 'submitting' | 'success' | 'error'>(
    'idle'
  );
  const [reportError, setReportError] = useState<string | null>(null);

  const closeReportPanel = useCallback(() => {
    setReportOpen(false);
    setReportPhase('idle');
    setReportError(null);
  }, []);

  const triggerDownload = useCallback(
    async (filename: string) => {
      setDownloadState('fetching');
      setDownloadError(null);

      try {
        const res = await fetch(`/api/share/${token}/download`, {
          headers: { accept: 'application/json' }
        });
        const body = (await res.json()) as unknown;

        if (res.ok && isOkEnvelope(body)) {
          const { url } = body.data as unknown as { url: string };

          // Programmatic download: create a temporary anchor to force file save.
          // Dynamically created so no focusable element is left in the DOM.
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = filename;
          anchor.setAttribute('rel', 'noopener noreferrer');
          document.body.appendChild(anchor);
          anchor.click();
          document.body.removeChild(anchor);

          setDownloadState('idle');
          if (loader?.ok && loader.data?.oneTime) {
            setConsumed(true);
          }
        } else {
          if (isErrorEnvelope(body)) {
            const { code, message } = body.error;

            if (code === 'file_consumed') {
              setConsumed(true);
              setDownloadError(null);
              setDownloadState('idle');
              return;
            }

            if (RUNTIME_UNAVAILABLE_CODES.has(code)) {
              setRuntimeUnavailable({ code, message });
              setDownloadError(null);
              setDownloadState('idle');
              return;
            }

            setDownloadError(message);
            setDownloadState('error');
            return;
          }

          setDownloadError('Download failed. Please try again.');
          setDownloadState('error');
        }
      } catch {
        setDownloadError('Download failed. Please check your connection.');
        setDownloadState('error');
      }
    },
    [token, loader]
  );

  const loadPreview = useCallback(async () => {
    if (previewState === 'ready' || previewState === 'loading') return;
    setPreviewState('loading');

    try {
      const res = await fetch(`/api/share/${token}/preview`, {
        headers: { accept: 'application/json' }
      });
      const body = (await res.json()) as unknown;

      if (res.ok && isOkEnvelope(body)) {
        const d = body.data as unknown as { url: string; mimeType: string };
        setPreviewUrl(d.url);
        setPreviewMime(d.mimeType);
        setPreviewState('ready');
      } else {
        if (isErrorEnvelope(body) && RUNTIME_UNAVAILABLE_CODES.has(body.error.code)) {
          setRuntimeUnavailable({ code: body.error.code, message: body.error.message });
          setPreviewState('hidden');
          return;
        }

        setPreviewState('error');
      }
    } catch {
      setPreviewState('error');
    }
  }, [token, previewState]);

  const refreshAvailability = useCallback(async () => {
    try {
      const res = await fetch(`/api/share/${token}`, {
        headers: { accept: 'application/json' }
      });
      const body = (await res.json()) as unknown;

      if (res.ok) {
        setRuntimeUnavailable(null);
        return;
      }

      if (isErrorEnvelope(body) && RUNTIME_UNAVAILABLE_CODES.has(body.error.code)) {
        setRuntimeUnavailable({ code: body.error.code, message: body.error.message });
      }
    } catch {
      // Best effort only; keep existing UI state on transient refresh failures.
    }
  }, [token]);

  const submitReport = useCallback(async () => {
    if (reportPhase === 'submitting') return;
    setReportPhase('submitting');
    setReportError(null);

    try {
      const res = await fetch(`/api/report/${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          reason: reportReason,
          ...(reportMessage.trim() ? { message: reportMessage.trim() } : {})
        })
      });

      if (res.ok) {
        setReportPhase('success');
        void refreshAvailability();
      } else {
        const body = (await res.json()) as unknown;
        const msg = isErrorEnvelope(body)
          ? body.error.message
          : 'Failed to submit. Please try again.';
        setReportError(msg);
        setReportPhase('error');
      }
    } catch {
      setReportError('Failed to submit. Please check your connection.');
      setReportPhase('error');
    }
  }, [token, reportReason, reportMessage, reportPhase, refreshAvailability]);

  // Guard: loader is always defined at render time, but TypeScript cannot prove it.
  if (loader === undefined) return null;

  // ── Unavailable state ───────────────────────────────────────────────────────
  if (!loader.ok || !loader.data) {
    const code = loader.errorCode ?? 'file_unavailable';
    const info: UnavailabilityInfo = UNAVAILABILITY[code] ?? {
      label: 'Unavailable',
      message: loader.errorMessage || 'This file is not available right now.'
    };

    return (
      <SiteFrame eyebrow="File link" title={info.label} summary={info.message}>
        <section className="panel panel--unavailable">
          <div className="unavail-icon" aria-hidden="true">
            {code === 'file_expired' ? '⏳' : code === 'file_consumed' ? '✓' : '⊘'}
          </div>
          <p className="unavail-message">{info.message}</p>
          <div className="action-row">
            <Link to="/" className="button-link">
              Share a new file
            </Link>
          </div>
        </section>
        {canReportUnavailableFile(code) && (
          <PublicReportPanel
            reportOpen={reportOpen}
            reportReason={reportReason}
            reportMessage={reportMessage}
            reportPhase={reportPhase}
            reportError={reportError}
            onOpen={() => setReportOpen(true)}
            onReasonChange={setReportReason}
            onMessageChange={setReportMessage}
            onSubmit={submitReport}
            onCancel={closeReportPanel}
            copy="If this link contained illegal or harmful content, you can still "
          />
        )}
      </SiteFrame>
    );
  }

  if (runtimeUnavailable) {
    const code = runtimeUnavailable.code;
    const info: UnavailabilityInfo = UNAVAILABILITY[code] ?? {
      label: 'Unavailable',
      message: runtimeUnavailable.message || 'This file is not available right now.'
    };

    return (
      <SiteFrame eyebrow="File link" title={info.label} summary={info.message}>
        <section className="panel panel--unavailable">
          <div className="unavail-icon" aria-hidden="true">
            {code === 'file_expired' ? '⏳' : code === 'file_consumed' ? '✓' : '⊘'}
          </div>
          <p className="unavail-message">{info.message}</p>
          <div className="action-row">
            <Link to="/" className="button-link">
              Share a new file
            </Link>
          </div>
        </section>
        {canReportUnavailableFile(code) && (
          <PublicReportPanel
            reportOpen={reportOpen}
            reportReason={reportReason}
            reportMessage={reportMessage}
            reportPhase={reportPhase}
            reportError={reportError}
            onOpen={() => setReportOpen(true)}
            onReasonChange={setReportReason}
            onMessageChange={setReportMessage}
            onSubmit={submitReport}
            onCancel={closeReportPanel}
            copy="If this link contained illegal or harmful content, you can still "
          />
        )}
      </SiteFrame>
    );
  }

  const file = loader.data;
  const isExpired = file.status === 'expired';
  const isExpiring = file.status === 'expiring';
  const previewSupportedForMime = isPreviewSupported(file.mimeType);
  const canDownload = !consumed && !isExpired;
  const canPreview =
    !consumed && !isExpired && file.allowPreview && !file.oneTime && previewSupportedForMime;

  return (
    <SiteFrame
      eyebrow="Shared file"
      title={file.filename}
      summary={`${mimeLabel(file.mimeType)} · ${formatBytes(file.sizeBytes)}`}
    >
      {/* ── File metadata ─────────────────────────────────────────────────── */}
      <section className="panel panel--feature">
        <div className="panel__row">
          <p className="panel__label">File details</p>
          <div className="badge-row">
            {consumed ? (
              <span className="status-badge status-badge--consumed">Downloaded</span>
            ) : isExpired ? (
              <span className="status-badge status-badge--expired">Expired</span>
            ) : isExpiring ? (
              <span className="status-badge status-badge--expiring">Expiring soon</span>
            ) : (
              <span className="status-badge status-badge--active">Available</span>
            )}
            {file.oneTime && <span className="status-badge status-badge--onetime">One-time</span>}
            {canPreview && <span className="status-badge status-badge--preview">Preview</span>}
          </div>
        </div>

        <div className="file-meta-grid">
          <div className="file-meta-item">
            <span className="file-meta-item__label">Type</span>
            <span className="file-meta-item__value">{mimeLabel(file.mimeType)}</span>
          </div>
          <div className="file-meta-item">
            <span className="file-meta-item__label">Size</span>
            <span className="file-meta-item__value">{formatBytes(file.sizeBytes)}</span>
          </div>
          {file.expiresAt && (
            <div className="file-meta-item">
              <span className="file-meta-item__label">Expires</span>
              <span className="file-meta-item__value">
                {new Date(file.expiresAt).toLocaleDateString(undefined, {
                  dateStyle: 'medium'
                })}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* ── Consumed notice ───────────────────────────────────────────────── */}
      {consumed && (
        <section className="panel panel--unavailable">
          <p className="unavail-message">
            You just downloaded this one-time file. The link is now inactive.
          </p>
          <div className="action-row">
            <Link to="/" className="button-link">
              Share a new file
            </Link>
          </div>
        </section>
      )}

      {/* ── Preview ───────────────────────────────────────────────────────── */}
      {canPreview && (
        <section className="panel">
          <div className="panel__row">
            <p className="panel__label">Preview</p>
            {previewState === 'hidden' && (
              <button
                type="button"
                className="button-link button-link--ghost button-link--sm"
                onClick={loadPreview}
              >
                Load preview
              </button>
            )}
          </div>

          {previewState === 'loading' && <p className="preview-panel__loading">Loading preview…</p>}
          {previewState === 'error' && (
            <div className="preview-panel__error">
              <p>Preview unavailable for this file.</p>
              <button
                type="button"
                className="button-link button-link--ghost button-link--sm"
                onClick={loadPreview}
              >
                Retry preview
              </button>
            </div>
          )}
          {previewState === 'ready' && previewUrl && (
            <PreviewPanel url={previewUrl} mimeType={previewMime} />
          )}
        </section>
      )}

      {!consumed &&
        !isExpired &&
        file.allowPreview &&
        !file.oneTime &&
        !previewSupportedForMime && (
          <section className="panel panel--muted">
            <p className="panel__copy">
              Preview is not available for this file type. You can still download the file.
            </p>
          </section>
        )}

      {/* ── Download ──────────────────────────────────────────────────────── */}
      {canDownload && (
        <section className="panel panel--muted">
          <div className="panel__row">
            <p className="panel__label">Download</p>
          </div>

          {file.oneTime && (
            <p className="one-time-warning">
              This is a one-time link. The file will be permanently unavailable after you download
              it.
            </p>
          )}

          {downloadError && <p className="upload-error">{downloadError}</p>}

          <div className="action-row">
            <button
              type="button"
              className="button-link"
              disabled={downloadState === 'fetching'}
              onClick={() => triggerDownload(file.filename)}
            >
              {downloadState === 'fetching' ? 'Preparing…' : 'Download file'}
            </button>
          </div>
        </section>
      )}

      {/* ── Report link ───────────────────────────────────────────────────── */}
      <PublicReportPanel
        reportOpen={reportOpen}
        reportReason={reportReason}
        reportMessage={reportMessage}
        reportPhase={reportPhase}
        reportError={reportError}
        onOpen={() => setReportOpen(true)}
        onReasonChange={setReportReason}
        onMessageChange={setReportMessage}
        onSubmit={submitReport}
        onCancel={closeReportPanel}
      />
    </SiteFrame>
  );
}
