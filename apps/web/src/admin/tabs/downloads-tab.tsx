import type { AdminDownloadListResponse } from '@anonshare/contracts';
import { useEffect, useState } from 'react';
import { AdminAccessError } from '~/admin/access';
import { formatCount, formatDateTime } from '~/admin/formatters';
import { runTrackedRequest, useRequestTracker } from '~/admin/request-tracker';
import { DOWNLOAD_PAGE_SIZE, fetchAdminDownloads, type OnAdminAccessLost } from '~/admin/transport';

export function DownloadsTab({
  onInspect,
  onAccessLost
}: {
  onInspect: (fileId: string) => void;
  onAccessLost: OnAdminAccessLost;
}) {
  const requestTracker = useRequestTracker();
  const [downloads, setDownloads] = useState<AdminDownloadListResponse['downloads']>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [fileIdFilter, setFileIdFilter] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    void runTrackedRequest({
      tracker: requestTracker,
      run: (signal) => fetchAdminDownloads(fileIdFilter || null, page, signal),
      onSuccess: (res) => {
        setDownloads(res.downloads);
        setTotal(res.total);
      },
      onError: (err: unknown) => {
        if (err instanceof AdminAccessError) {
          onAccessLost(err);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load downloads.');
      },
      onFinally: () => setIsLoading(false)
    });
  }, [fileIdFilter, onAccessLost, page, requestTracker]);

  const totalPages = Math.ceil(total / DOWNLOAD_PAGE_SIZE);

  return (
    <section className="panel">
      <div className="panel__row">
        <p className="panel__label">Download activity</p>
        <span className="chip chip--outline">{formatCount(total)} events</span>
      </div>

      {error ? <p className="upload-error">{error}</p> : null}

      {isLoading ? (
        <div className="state-empty">
          <strong>Loading download events…</strong>
        </div>
      ) : downloads.length === 0 ? (
        <div className="state-empty">
          <strong>No download events recorded yet.</strong>
        </div>
      ) : (
        <div className="report-queue">
          {downloads.map((dl) => (
            <article key={dl.id} className="report-card report-card--compact">
              <div className="report-card__header">
                <div>
                  <p className="surface-card__index">{dl.eventType}</p>
                  <h2>File {dl.fileId.slice(0, 8)}</h2>
                </div>
                <span className="chip chip--outline">{formatDateTime(dl.createdAt)}</span>
              </div>
              <div className="report-card__actions">
                <button
                  type="button"
                  className="button-link button-link--ghost button-link--sm"
                  onClick={() => onInspect(dl.fileId)}
                >
                  Inspect file
                </button>
                <button
                  type="button"
                  className="button-link button-link--ghost button-link--sm"
                  onClick={() => {
                    setFileIdFilter(dl.fileId);
                    setPage(1);
                  }}
                >
                  Filter by file
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {fileIdFilter ? (
        <div className="report-card__actions" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="button-link button-link--ghost button-link--sm"
            onClick={() => {
              setFileIdFilter('');
              setPage(1);
            }}
          >
            Clear file filter
          </button>
          <span className="chip chip--outline">Filtered: {fileIdFilter.slice(0, 8)}…</span>
        </div>
      ) : null}

      {totalPages > 1 ? (
        <div className="report-card__actions" style={{ marginTop: 14 }}>
          <button
            type="button"
            className="button-link button-link--ghost button-link--sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
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
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </div>
      ) : null}
    </section>
  );
}
