import type { AdminFileSummary } from '@anonshare/contracts';
import { useCallback, useEffect, useState } from 'react';
import { AdminAccessError } from '~/admin/access';
import { canHideFileStatus, confirmModerationAction } from '~/admin/dashboard';
import { formatBytes, formatCount, formatDateTime, formatFileStatus } from '~/admin/formatters';
import { runTrackedRequest, useRequestTracker } from '~/admin/request-tracker';
import { FILE_PAGE_SIZE, fetchAdminFiles, type OnAdminAccessLost } from '~/admin/transport';

// ─── Filter constants ────────────────────────────────────────────────────────

const FILE_STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'expiring', label: 'Expiring' },
  { value: 'expired', label: 'Expired' },
  { value: 'hidden', label: 'Hidden' },
  { value: 'deleted', label: 'Deleted' },
  { value: 'consumed', label: 'Consumed' }
] as const;

const FILE_SORT_OPTIONS = [
  { value: 'uploadedAt_desc', label: 'Latest' },
  { value: 'sizeBytes_desc', label: 'Largest' },
  { value: 'reportCount_desc', label: 'Most reported' }
] as const;

const FILE_POLICY_FILTERS = [
  { value: '', label: 'Any policy' },
  { value: 'standard', label: 'Standard' },
  { value: 'one_time', label: 'One-time' },
  { value: 'preview_enabled', label: 'Preview enabled' }
] as const;

const FILE_DATE_FILTERS = [
  { value: '', label: 'Any time' },
  { value: 1, label: '24h' },
  { value: 7, label: '7d' },
  { value: 30, label: '30d' }
] as const;

const FILE_REPORT_VOLUME_FILTERS = [
  { value: '', label: 'Any reports' },
  { value: 1, label: '1+ reports' },
  { value: 3, label: '3+ reports' }
] as const;

// ─── Component ───────────────────────────────────────────────────────────────

export function FilesTab({
  onInspect,
  onModerate,
  onAccessLost
}: {
  onInspect: (fileId: string) => void;
  onModerate: (fileId: string, action: 'hide' | 'restore' | 'delete') => Promise<void>;
  onAccessLost: OnAdminAccessLost;
}) {
  const requestTracker = useRequestTracker();
  const [files, setFiles] = useState<AdminFileSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [policyFilter, setPolicyFilter] = useState<
    '' | 'standard' | 'one_time' | 'preview_enabled'
  >('');
  const [sortBy, setSortBy] = useState<'uploadedAt_desc' | 'sizeBytes_desc' | 'reportCount_desc'>(
    'uploadedAt_desc'
  );
  const [uploadedWithinDays, setUploadedWithinDays] = useState<number | null>(null);
  const [minReportCount, setMinReportCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const loadFiles = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    await runTrackedRequest({
      tracker: requestTracker,
      run: (signal) =>
        fetchAdminFiles(
          statusFilter || null,
          policyFilter || null,
          sortBy,
          uploadedWithinDays,
          minReportCount,
          page,
          signal
        ),
      onSuccess: (res) => {
        setFiles(res.files);
        setTotal(res.total);
      },
      onError: (err: unknown) => {
        if (err instanceof AdminAccessError) {
          onAccessLost(err);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load files.');
      },
      onFinally: () => setIsLoading(false)
    });
  }, [
    minReportCount,
    onAccessLost,
    page,
    policyFilter,
    requestTracker,
    sortBy,
    statusFilter,
    uploadedWithinDays
  ]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  const handleModerate = async (
    fileId: string,
    action: 'hide' | 'restore' | 'delete',
    targetLabel: string
  ) => {
    if (!confirmModerationAction(action, targetLabel)) {
      return;
    }

    setPendingAction(fileId);
    try {
      await onModerate(fileId, action);
      void loadFiles();
    } catch (err: unknown) {
      if (err instanceof AdminAccessError) {
        onAccessLost(err);
        return;
      }
      setError(err instanceof Error ? err.message : 'Moderation action failed.');
    } finally {
      setPendingAction(null);
    }
  };

  const totalPages = Math.ceil(total / FILE_PAGE_SIZE);

  return (
    <section className="panel">
      <div className="panel__row">
        <p className="panel__label">Files</p>
        <span className="chip chip--outline">{formatCount(total)} total</span>
      </div>

      <div className="admin-nav">
        {FILE_STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            className={`admin-nav__tab ${statusFilter === f.value ? 'admin-nav__tab--active' : ''}`}
            onClick={() => {
              setPage(1);
              setStatusFilter(f.value);
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <nav className="admin-nav" aria-label="Sort files by">
        {FILE_SORT_OPTIONS.map((s) => (
          <button
            key={s.value}
            type="button"
            className={`admin-nav__tab admin-nav__tab--sm ${sortBy === s.value ? 'admin-nav__tab--active' : ''}`}
            onClick={() => {
              setPage(1);
              setSortBy(s.value);
            }}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <nav className="admin-nav" aria-label="Filter files by policy">
        {FILE_POLICY_FILTERS.map((option) => (
          <button
            key={option.label}
            type="button"
            className={`admin-nav__tab admin-nav__tab--sm ${policyFilter === option.value ? 'admin-nav__tab--active' : ''}`}
            onClick={() => {
              setPage(1);
              setPolicyFilter(option.value);
            }}
          >
            {option.label}
          </button>
        ))}
      </nav>

      <nav className="admin-nav" aria-label="Filter files by upload date">
        {FILE_DATE_FILTERS.map((option) => (
          <button
            key={option.label}
            type="button"
            className={`admin-nav__tab admin-nav__tab--sm ${uploadedWithinDays === (option.value || null) ? 'admin-nav__tab--active' : ''}`}
            onClick={() => {
              setPage(1);
              setUploadedWithinDays(option.value || null);
            }}
          >
            {option.label}
          </button>
        ))}
      </nav>

      <nav className="admin-nav" aria-label="Filter files by report volume">
        {FILE_REPORT_VOLUME_FILTERS.map((option) => (
          <button
            key={option.label}
            type="button"
            className={`admin-nav__tab admin-nav__tab--sm ${minReportCount === (option.value || null) ? 'admin-nav__tab--active' : ''}`}
            onClick={() => {
              setPage(1);
              setMinReportCount(option.value || null);
            }}
          >
            {option.label}
          </button>
        ))}
      </nav>

      {error ? <p className="upload-error">{error}</p> : null}

      {isLoading ? (
        <div className="state-empty">
          <strong>Loading files…</strong>
        </div>
      ) : files.length === 0 ? (
        <div className="state-empty">
          <strong>No files match this filter.</strong>
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
                {file.mimeType} · {file.reportCount > 0 ? `${file.reportCount} reports · ` : ''}
                {file.oneTimeDownload ? 'one-time · ' : ''}
                uploaded {formatDateTime(file.uploadedAt)}
                {file.expiresAt ? ` · expires ${formatDateTime(file.expiresAt)}` : ''}
              </p>
              <div className="report-card__actions">
                {canHideFileStatus(file.status) ? (
                  <button
                    type="button"
                    className="button-link button-link--ghost button-link--sm"
                    disabled={pendingAction === file.id}
                    onClick={() => handleModerate(file.id, 'hide', file.sanitizedFilename)}
                  >
                    {pendingAction === file.id ? 'Saving…' : 'Hide'}
                  </button>
                ) : null}
                {file.status === 'hidden' ? (
                  <button
                    type="button"
                    className="button-link button-link--sm"
                    disabled={pendingAction === file.id}
                    onClick={() => handleModerate(file.id, 'restore', file.sanitizedFilename)}
                  >
                    {pendingAction === file.id ? 'Saving…' : 'Restore'}
                  </button>
                ) : null}
                {file.status !== 'deleted' ? (
                  <button
                    type="button"
                    className="button-link button-link--ghost button-link--sm"
                    disabled={pendingAction === file.id}
                    onClick={() => handleModerate(file.id, 'delete', file.sanitizedFilename)}
                  >
                    Delete
                  </button>
                ) : null}
                <button
                  type="button"
                  className="button-link button-link--ghost button-link--sm"
                  onClick={() => onInspect(file.id)}
                >
                  Inspect
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
