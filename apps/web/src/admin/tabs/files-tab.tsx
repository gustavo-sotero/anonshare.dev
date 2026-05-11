import type { AdminFileSummary } from '@anonshare/contracts';
import { useCallback, useEffect, useState } from 'react';
import { AdminAccessError } from '~/admin/access';
import { canHideFileStatus, confirmModerationAction } from '~/admin/dashboard';
import { formatBytes, formatCount, formatDateTime, formatFileStatus } from '~/admin/formatters';
import { runTrackedRequest, useRequestTracker } from '~/admin/request-tracker';
import type { AdminSearchParams, AdminSearchUpdate } from '~/admin/search-params';
import { fetchAdminFiles, type OnAdminAccessLost } from '~/admin/transport';

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
  searchState,
  onUpdateSearch,
  onInspect,
  onModerate,
  onAccessLost
}: {
  searchState?: AdminSearchParams | undefined;
  onUpdateSearch?: ((updates: AdminSearchUpdate) => void) | undefined;
  onInspect: (fileId: string) => void;
  onModerate: (fileId: string, action: 'hide' | 'restore' | 'delete') => Promise<void>;
  onAccessLost: OnAdminAccessLost;
}) {
  const requestTracker = useRequestTracker();
  const [files, setFiles] = useState<AdminFileSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const cursor = searchState?.filesCursor ?? null;
  const statusFilter = searchState?.filesStatus ?? '';
  const policyFilter = searchState?.filesPolicy ?? '';
  const sortBy = searchState?.filesSortBy ?? 'uploadedAt_desc';
  const uploadedWithinDays = searchState?.filesDays ?? null;
  const minReportCount = searchState?.filesMinReports ?? null;

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
          cursor,
          signal
        ),
      onSuccess: (res) => {
        setFiles(res.files);
        setNextCursor(res.nextCursor);
        setHasMore(res.hasMore);
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
    cursor,
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

  return (
    <section className="panel">
      <div className="panel__row">
        <p className="panel__label">Files</p>
        <span className="chip chip--outline">
          {formatCount(files.length)}
          {hasMore ? '+' : ''} shown
        </span>
      </div>

      <fieldset className="admin-nav">
        <legend className="sr-only">Filter files by status</legend>
        {FILE_STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={statusFilter === f.value}
            className={`admin-nav__tab ${statusFilter === f.value ? 'admin-nav__tab--active' : ''}`}
            onClick={() => onUpdateSearch?.({ filesStatus: f.value, filesCursor: undefined })}
          >
            {f.label}
          </button>
        ))}
      </fieldset>

      <fieldset className="admin-nav">
        <legend className="sr-only">Sort files by</legend>
        {FILE_SORT_OPTIONS.map((s) => (
          <button
            key={s.value}
            type="button"
            aria-pressed={sortBy === s.value}
            className={`admin-nav__tab admin-nav__tab--sm ${sortBy === s.value ? 'admin-nav__tab--active' : ''}`}
            onClick={() => onUpdateSearch?.({ filesSortBy: s.value, filesCursor: undefined })}
          >
            {s.label}
          </button>
        ))}
      </fieldset>

      <fieldset className="admin-nav">
        <legend className="sr-only">Filter files by policy</legend>
        {FILE_POLICY_FILTERS.map((option) => (
          <button
            key={option.label}
            type="button"
            aria-pressed={policyFilter === option.value}
            className={`admin-nav__tab admin-nav__tab--sm ${policyFilter === option.value ? 'admin-nav__tab--active' : ''}`}
            onClick={() => onUpdateSearch?.({ filesPolicy: option.value, filesCursor: undefined })}
          >
            {option.label}
          </button>
        ))}
      </fieldset>

      <fieldset className="admin-nav">
        <legend className="sr-only">Filter files by upload date</legend>
        {FILE_DATE_FILTERS.map((option) => {
          const activeVal = option.value || null;
          return (
            <button
              key={option.label}
              type="button"
              aria-pressed={uploadedWithinDays === activeVal}
              className={`admin-nav__tab admin-nav__tab--sm ${uploadedWithinDays === activeVal ? 'admin-nav__tab--active' : ''}`}
              onClick={() =>
                onUpdateSearch?.({ filesDays: option.value || undefined, filesCursor: undefined })
              }
            >
              {option.label}
            </button>
          );
        })}
      </fieldset>

      <fieldset className="admin-nav">
        <legend className="sr-only">Filter files by report volume</legend>
        {FILE_REPORT_VOLUME_FILTERS.map((option) => {
          const activeVal = option.value || null;
          return (
            <button
              key={option.label}
              type="button"
              aria-pressed={minReportCount === activeVal}
              className={`admin-nav__tab admin-nav__tab--sm ${minReportCount === activeVal ? 'admin-nav__tab--active' : ''}`}
              onClick={() =>
                onUpdateSearch?.({
                  filesMinReports: option.value || undefined,
                  filesCursor: undefined
                })
              }
            >
              {option.label}
            </button>
          );
        })}
      </fieldset>

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

      {hasMore || cursor ? (
        <div className="report-card__actions" style={{ marginTop: 14 }}>
          {cursor ? (
            <button
              type="button"
              className="button-link button-link--ghost button-link--sm"
              onClick={() => onUpdateSearch?.({ filesCursor: undefined })}
            >
              ← First page
            </button>
          ) : null}
          {hasMore ? (
            <button
              type="button"
              className="button-link button-link--ghost button-link--sm"
              disabled={!nextCursor}
              onClick={() => nextCursor && onUpdateSearch?.({ filesCursor: nextCursor })}
            >
              Next →
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
