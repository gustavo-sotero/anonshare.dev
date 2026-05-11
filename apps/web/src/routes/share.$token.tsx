import type { FileMetaResponse } from '@anonshare/contracts';
import { isPreviewSupported } from '@anonshare/domain';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SiteFrame } from '~/components/site-frame';
import { formatDateDeterministic } from '~/share/date-format';
import { createInitialSharePageUiState, type ReportReason } from '~/share/page-state';
import { PreviewPanel } from '~/share/preview';
import { PublicReportPanel, type ReportPhase } from '~/share/report-panel';
import { canReportUnavailableFile } from '~/share/reporting';
import {
  fetchDownloadUrl,
  fetchPreviewUrl,
  fetchShareMeta,
  refreshShareAvailability,
  submitShareReport
} from '~/share/transport';
import { UnavailableFilePageFromCode } from '~/share/unavailable-page';
import { formatBytes } from '~/utils/format';

// ─── Loader result type (shared between head, loader, and component) ──────────

type LoaderResult =
  | { ok: true; status: 200; data: FileMetaResponse; errorCode: null }
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
  loader: async ({ params, abortController }): Promise<LoaderResult> => {
    // Loader runs isomorphically — detect server vs browser context.
    // On the server during SSR, call the Hono API directly via env URL.
    // On the client during navigation, use the /api proxy path.
    const isServer = typeof window === 'undefined';
    const apiBase = isServer ? (process.env.APP_API_URL ?? 'http://localhost:3001') : '/api';

    let result: Awaited<ReturnType<typeof fetchShareMeta>>;
    try {
      result = await fetchShareMeta(apiBase, params.token, abortController.signal);
    } catch {
      return {
        ok: false as const,
        status: 503,
        data: null,
        errorCode: 'file_unavailable',
        errorMessage: 'This file is temporarily unavailable. Please try again in a moment.'
      };
    }

    if (result.ok) {
      return { ok: true as const, status: 200, data: result.data, errorCode: null };
    }

    return {
      ok: false as const,
      status: result.status,
      data: null,
      errorCode: result.code,
      errorMessage: result.message
    };
  },
  component: SharePage
});

// ─── Utilities ────────────────────────────────────────────────────────────────

function mimeLabel(mimeType: string): string {
  const parts = mimeType.split('/');
  const type = parts[0] ?? mimeType;
  const sub = parts[1];
  const base = sub ?? type;
  const clean = (base.split(';')[0] ?? base).toUpperCase();
  return clean.slice(0, 20);
}

const RUNTIME_UNAVAILABLE_CODES = new Set([
  'file_expired',
  'file_consumed',
  'file_hidden',
  'file_deleted',
  'file_unavailable',
  'not_found'
]);

// ─── Main share page component ────────────────────────────────────────────────

// Thin shell: forces a full remount of SharePageContent on every token change.
// This replaces the previous useEffect-based state reset anti-pattern.
function SharePage() {
  const { token } = Route.useParams();
  return <SharePageContent key={token} />;
}

function SharePageContent() {
  const { token } = Route.useParams();
  // Cast required: TanStack Router infers useLoaderData() as `never` when the
  // component is defined after the Route object (circular reference at definition
  // time). The explicit cast is safe — the loader always returns LoaderResult.
  const loader = Route.useLoaderData() as LoaderResult | undefined;
  const initialUiState = createInitialSharePageUiState();

  // All hooks must be declared unconditionally before any early returns.
  const [downloadState, setDownloadState] = useState<'idle' | 'fetching' | 'error'>(
    initialUiState.downloadState
  );
  const [downloadError, setDownloadError] = useState<string | null>(initialUiState.downloadError);
  const [previewState, setPreviewState] = useState<'hidden' | 'loading' | 'ready' | 'error'>(
    initialUiState.previewState
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialUiState.previewUrl);
  const [previewMime, setPreviewMime] = useState<string>(initialUiState.previewMime);
  // Track whether a one-time file has been consumed in this session
  const [consumed, setConsumed] = useState(initialUiState.consumed);
  const [runtimeUnavailable, setRuntimeUnavailable] = useState<{
    code: string;
    message: string;
  } | null>(initialUiState.runtimeUnavailable);
  // Report section state
  const [reportOpen, setReportOpen] = useState(initialUiState.reportOpen);
  const [reportReason, setReportReason] = useState<ReportReason>(initialUiState.reportReason);
  const [reportMessage, setReportMessage] = useState(initialUiState.reportMessage);
  const [reportPhase, setReportPhase] = useState<ReportPhase>(initialUiState.reportPhase);
  const [reportError, setReportError] = useState<string | null>(initialUiState.reportError);

  // Abort controllers for in-flight requests so they can be cancelled when the
  // component unmounts (handled implicitly by key-based remount on token change).
  const downloadAbortRef = useRef<AbortController | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const reportAbortRef = useRef<AbortController | null>(null);

  const closeReportPanel = useCallback(() => {
    setReportOpen(false);
    setReportPhase('idle');
    setReportError(null);
  }, []);

  useEffect(() => {
    return () => {
      downloadAbortRef.current?.abort();
      previewAbortRef.current?.abort();
      reportAbortRef.current?.abort();
    };
  }, []);

  const refreshAvailability = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const result = await refreshShareAvailability(token, signal);
        if (result.ok) {
          setRuntimeUnavailable(null);
          return;
        }
        if (RUNTIME_UNAVAILABLE_CODES.has(result.code)) {
          setRuntimeUnavailable({ code: result.code, message: result.message });
        }
      } catch {
        // Best effort only; keep existing UI state on transient refresh failures.
      }
    },
    [token]
  );

  const triggerDownload = useCallback(
    async (filename: string) => {
      downloadAbortRef.current?.abort();
      const controller = new AbortController();
      downloadAbortRef.current = controller;

      setDownloadState('fetching');
      setDownloadError(null);

      try {
        const result = await fetchDownloadUrl(token, controller.signal);

        if (result.ok) {
          const { url } = result.data;

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
          return;
        }

        const { code, message } = result;

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
      } catch {
        if (!controller.signal.aborted) {
          setDownloadError('Download failed. Please check your connection.');
          setDownloadState('error');
        }
      }
    },
    [token, loader]
  );

  const loadPreview = useCallback(async () => {
    if (previewState === 'ready' || previewState === 'loading') return;

    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;

    setPreviewState('loading');

    try {
      const result = await fetchPreviewUrl(token, controller.signal);

      if (result.ok) {
        setPreviewUrl(result.data.url);
        setPreviewMime(result.data.mimeType);
        setPreviewState('ready');
        return;
      }

      if (RUNTIME_UNAVAILABLE_CODES.has(result.code)) {
        setRuntimeUnavailable({ code: result.code, message: result.message });
        setPreviewState('hidden');
        return;
      }

      setPreviewState('error');
    } catch {
      if (!controller.signal.aborted) {
        setPreviewState('error');
      }
    }
  }, [token, previewState]);

  const submitReport = useCallback(async () => {
    if (reportPhase === 'submitting') return;

    reportAbortRef.current?.abort();
    const controller = new AbortController();
    reportAbortRef.current = controller;

    setReportPhase('submitting');
    setReportError(null);

    try {
      const result = await submitShareReport(
        token,
        reportReason,
        reportMessage.trim() || null,
        controller.signal
      );

      if (result.ok) {
        setReportPhase('success');
        void refreshAvailability(controller.signal);
        return;
      }

      setReportError(result.message);
      setReportPhase('error');
    } catch {
      if (!controller.signal.aborted) {
        setReportError('Failed to submit. Please check your connection.');
        setReportPhase('error');
      }
    }
  }, [token, reportReason, reportMessage, reportPhase, refreshAvailability]);

  // Guard: loader is always defined at render time, but TypeScript cannot prove it.
  if (loader === undefined) return null;

  // ── Unavailable state ───────────────────────────────────────────────────────
  if (!loader.ok || !loader.data) {
    const code = loader.errorCode ?? 'file_unavailable';

    return (
      <UnavailableFilePageFromCode
        code={code}
        errorMessage={loader.errorMessage}
        reportPanel={
          canReportUnavailableFile(code) ? (
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
          ) : undefined
        }
      />
    );
  }

  if (runtimeUnavailable) {
    const code = runtimeUnavailable.code;

    return (
      <UnavailableFilePageFromCode
        code={code}
        errorMessage={runtimeUnavailable.message}
        reportPanel={
          canReportUnavailableFile(code) ? (
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
          ) : undefined
        }
      />
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
      noRail
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
                {formatDateDeterministic(file.expiresAt)}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* ── Consumed notice ───────────────────────────────────────────────── */}
      {/* Two representations of the consumed state are intentional:
          1. Full-page unavailable shell: rendered when the loader discovers the file
             is already consumed before the page mounts (visit after prior download).
          2. Inline consumed notice (this branch): rendered when the file becomes
             consumed during the current session, immediately after a successful
             first download. The inline notice keeps the file metadata visible so
             the user can confirm what they just downloaded. */}
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
