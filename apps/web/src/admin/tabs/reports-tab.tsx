import type { AdminReportSummary } from '@anonshare/contracts';
import { useCallback, useEffect, useState } from 'react';
import { AdminAccessError } from '~/admin/access';
import { confirmModerationAction } from '~/admin/dashboard';
import {
  formatCount,
  formatDateTime,
  formatReportReason,
  formatReportUrgency
} from '~/admin/formatters';
import { runTrackedRequest, useRequestTracker } from '~/admin/request-tracker';
import {
  extractErrorMessage,
  fetchAdminReports,
  type OnAdminAccessLost,
  postAdminJson,
  REPORT_PAGE_SIZE
} from '~/admin/transport';

// ─── Filter constants ────────────────────────────────────────────────────────

const REPORT_STATUS_FILTERS = [
  { value: 'pending', label: 'Pending' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'dismissed', label: 'Dismissed' }
] as const;

const REPORT_REASON_FILTERS = [
  { value: '', label: 'Any reason' },
  { value: 'illegal_content', label: 'Illegal content' },
  { value: 'copyright_violation', label: 'Copyright' },
  { value: 'malware', label: 'Malware' },
  { value: 'spam', label: 'Spam' },
  { value: 'other', label: 'Other' }
] as const;

const REPORT_URGENCY_FILTERS = [
  { value: '', label: 'Any urgency' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' }
] as const;

// ─── Component ───────────────────────────────────────────────────────────────

export function ReportsTab({
  onInspect,
  onModerateFile,
  onAccessLost
}: {
  onInspect: (fileId: string) => void;
  onModerateFile: (fileId: string, action: 'hide' | 'restore' | 'delete') => Promise<void>;
  onAccessLost: OnAdminAccessLost;
}) {
  const requestTracker = useRequestTracker();
  const [reports, setReports] = useState<AdminReportSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [reasonFilter, setReasonFilter] = useState<
    '' | 'illegal_content' | 'copyright_violation' | 'malware' | 'spam' | 'other'
  >('');
  const [urgencyFilter, setUrgencyFilter] = useState<'' | 'high' | 'medium' | 'low'>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    await runTrackedRequest({
      tracker: requestTracker,
      run: (signal) =>
        fetchAdminReports(statusFilter, page, reasonFilter || null, urgencyFilter || null, signal),
      onSuccess: (res) => {
        setReports(res.reports);
        setTotal(res.total);
      },
      onError: (err: unknown) => {
        if (err instanceof AdminAccessError) {
          onAccessLost(err);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load reports.');
      },
      onFinally: () => setIsLoading(false)
    });
  }, [onAccessLost, page, reasonFilter, requestTracker, statusFilter, urgencyFilter]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const resolveReport = async (reportId: string, action: 'resolved' | 'dismissed') => {
    setPendingAction(reportId);
    try {
      const result = await postAdminJson(
        `/api/admin/reports/${encodeURIComponent(reportId)}/resolve`,
        { action }
      );
      if (!result.ok) {
        throw new Error(extractErrorMessage(result.body, 'Failed to resolve report.'));
      }
      void loadReports();
    } catch (err: unknown) {
      if (err instanceof AdminAccessError) {
        onAccessLost(err);
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to resolve report.');
    } finally {
      setPendingAction(null);
    }
  };

  const handleModerateFile = async (fileId: string, action: 'hide' | 'restore' | 'delete') => {
    if (!confirmModerationAction(action, `file ${fileId.slice(0, 8)}`)) {
      return;
    }

    setPendingAction(fileId);
    try {
      await onModerateFile(fileId, action);
      void loadReports();
    } catch (err: unknown) {
      if (err instanceof AdminAccessError) {
        onAccessLost(err);
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to moderate file.');
    } finally {
      setPendingAction(null);
    }
  };

  const totalPages = Math.ceil(total / REPORT_PAGE_SIZE);

  return (
    <section className="panel">
      <div className="panel__row">
        <p className="panel__label">Reports</p>
        <span className="chip chip--outline">
          {formatCount(total)} {statusFilter}
        </span>
      </div>

      <div className="admin-nav">
        {REPORT_STATUS_FILTERS.map((f) => (
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

      <nav className="admin-nav" aria-label="Filter reports by reason">
        {REPORT_REASON_FILTERS.map((option) => (
          <button
            key={option.label}
            type="button"
            className={`admin-nav__tab admin-nav__tab--sm ${reasonFilter === option.value ? 'admin-nav__tab--active' : ''}`}
            onClick={() => {
              setPage(1);
              setReasonFilter(option.value);
            }}
          >
            {option.label}
          </button>
        ))}
      </nav>

      <nav className="admin-nav" aria-label="Filter reports by urgency">
        {REPORT_URGENCY_FILTERS.map((option) => (
          <button
            key={option.label}
            type="button"
            className={`admin-nav__tab admin-nav__tab--sm ${urgencyFilter === option.value ? 'admin-nav__tab--active' : ''}`}
            onClick={() => {
              setPage(1);
              setUrgencyFilter(option.value);
            }}
          >
            {option.label}
          </button>
        ))}
      </nav>

      {error ? <p className="upload-error">{error}</p> : null}

      {isLoading ? (
        <div className="state-empty">
          <strong>Loading reports…</strong>
        </div>
      ) : reports.length === 0 ? (
        <div className="state-empty">
          <strong>No {statusFilter} reports.</strong>
        </div>
      ) : (
        <div className="report-queue">
          {reports.map((report) => (
            <article key={report.id} className="report-card">
              <div className="report-card__header">
                <div>
                  <p className="surface-card__index">{formatReportReason(report.reason)}</p>
                  <h2>File {report.fileId.slice(0, 8)}</h2>
                </div>
                <div className="report-card__chips">
                  <span className={`chip chip--severity chip--severity-${report.urgency}`}>
                    {formatReportUrgency(report.urgency)}
                  </span>
                  <span className="chip chip--outline">{formatDateTime(report.createdAt)}</span>
                </div>
              </div>
              <p className="panel__copy report-card__message">
                {report.message?.trim() || 'No additional context provided.'}
              </p>
              {report.resolvedBy ? (
                <p className="panel__copy report-card__meta">
                  {report.status} by {report.resolvedBy}
                  {report.resolvedAt ? ` at ${formatDateTime(report.resolvedAt)}` : ''}
                </p>
              ) : null}
              <div className="report-card__actions">
                {report.status === 'pending' ? (
                  <>
                    <button
                      type="button"
                      className="button-link button-link--sm"
                      disabled={pendingAction === report.id}
                      onClick={() => resolveReport(report.id, 'resolved')}
                    >
                      {pendingAction === report.id ? 'Saving…' : 'Resolve'}
                    </button>
                    <button
                      type="button"
                      className="button-link button-link--ghost button-link--sm"
                      disabled={pendingAction === report.id}
                      onClick={() => resolveReport(report.id, 'dismissed')}
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      className="button-link button-link--ghost button-link--sm"
                      disabled={pendingAction === report.fileId}
                      onClick={() => handleModerateFile(report.fileId, 'hide')}
                    >
                      Hide file
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="button-link button-link--ghost button-link--sm"
                  onClick={() => onInspect(report.fileId)}
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
