import type { AdminFileSummary } from '@anonshare/contracts';
import { useEffect, useState } from 'react';
import { AdminAccessError } from '~/admin/access';
import { buildStorageHighlights } from '~/admin/dashboard';
import { formatBytes, formatCount, formatDateTime, formatFileStatus } from '~/admin/formatters';
import { runTrackedRequest, useRequestTracker } from '~/admin/request-tracker';
import {
  type DashboardData,
  FILE_PAGE_SIZE,
  fetchAdminFiles,
  type OnAdminAccessLost
} from '~/admin/transport';

export function StorageTab({
  data,
  onInspect,
  onAccessLost
}: {
  data: DashboardData;
  onInspect: (fileId: string) => void;
  onAccessLost: OnAdminAccessLost;
}) {
  const requestTracker = useRequestTracker();
  const [files, setFiles] = useState<AdminFileSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    void runTrackedRequest({
      tracker: requestTracker,
      run: (signal) => fetchAdminFiles(null, null, 'sizeBytes_desc', null, null, page, signal),
      onSuccess: (res) => {
        setFiles(res.files);
        setTotal(res.total);
      },
      onError: (err: unknown) => {
        if (err instanceof AdminAccessError) {
          onAccessLost(err);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load storage view.');
      },
      onFinally: () => setIsLoading(false)
    });
  }, [onAccessLost, page, requestTracker]);

  const highlights = buildStorageHighlights(data.overview, files);
  const totalPages = Math.ceil(total / FILE_PAGE_SIZE);

  return (
    <section className="panel">
      <div className="panel__row">
        <p className="panel__label">Storage</p>
        <span className="chip chip--outline">Largest files first</span>
      </div>

      <div className="metric-grid">
        <article className="metric-card">
          <p className="surface-card__index">Total storage</p>
          <strong className="metric-card__value">
            {formatBytes(highlights.totalStorageBytes)}
          </strong>
          <p className="metric-card__meta">Current object volume tracked in metadata.</p>
        </article>
        <article className="metric-card">
          <p className="surface-card__index">Publicly available</p>
          <strong className="metric-card__value">{formatCount(highlights.activeFileCount)}</strong>
          <p className="metric-card__meta">Active and expiring files still reachable by link.</p>
        </article>
        <article className="metric-card">
          <p className="surface-card__index">Non-public</p>
          <strong className="metric-card__value">
            {formatCount(highlights.nonPublicFileCount)}
          </strong>
          <p className="metric-card__meta">
            Hidden, deleted, expired, or consumed files awaiting cleanup or review.
          </p>
        </article>
        <article className="metric-card">
          <p className="surface-card__index">Largest object loaded</p>
          <strong className="metric-card__value">
            {highlights.largestFile ? formatBytes(highlights.largestFile.sizeBytes) : 'n/a'}
          </strong>
          <p className="metric-card__meta">
            {highlights.largestFile
              ? highlights.largestFile.sanitizedFilename
              : 'Load ranked files to inspect the heaviest object.'}
          </p>
        </article>
      </div>

      <div className="panel__row" style={{ marginTop: 20 }}>
        <p className="panel__label">Largest files</p>
        <span className="chip chip--outline">{formatCount(total)} tracked</span>
      </div>

      {error ? <p className="upload-error">{error}</p> : null}

      {isLoading ? (
        <div className="state-empty">
          <strong>Loading storage rankings…</strong>
        </div>
      ) : files.length === 0 ? (
        <div className="state-empty">
          <strong>No files available for storage ranking.</strong>
        </div>
      ) : (
        <div className="report-queue">
          {files.map((file) => (
            <article key={file.id} className="report-card">
              <div className="report-card__header">
                <div>
                  <p className="surface-card__index">{formatFileStatus(file.status)}</p>
                  <h2>{file.sanitizedFilename}</h2>
                </div>
                <span className="chip chip--outline">{formatBytes(file.sizeBytes)}</span>
              </div>
              <p className="panel__copy report-card__meta">
                {file.mimeType} · {file.reportCount} reports · uploaded{' '}
                {formatDateTime(file.uploadedAt)}
              </p>
              <div className="report-card__actions">
                <button
                  type="button"
                  className="button-link button-link--ghost button-link--sm"
                  onClick={() => onInspect(file.id)}
                >
                  Inspect file
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="report-card__actions" style={{ marginTop: 14 }}>
          <button
            type="button"
            className="button-link button-link--ghost button-link--sm"
            disabled={page <= 1}
            onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
          >
            ← Previous
          </button>
          <span className="chip chip--outline">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="button-link button-link--ghost button-link--sm"
            disabled={page >= totalPages}
            onClick={() => setPage((currentPage) => currentPage + 1)}
          >
            Next →
          </button>
        </div>
      ) : null}
    </section>
  );
}
