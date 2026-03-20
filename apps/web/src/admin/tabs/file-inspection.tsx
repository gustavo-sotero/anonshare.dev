import type { AdminFileDetail } from '@anonshare/contracts';
import { useCallback, useEffect, useState } from 'react';
import { AdminAccessError } from '~/admin/access';
import { canHideFileStatus, confirmModerationAction } from '~/admin/dashboard';
import {
  formatBytes,
  formatCount,
  formatDateTime,
  formatFileStatus,
  formatModerationTransition,
  formatOptionalDateTime,
  formatReportReason,
  formatReportUrgency,
  formatStorageObjectStatus
} from '~/admin/formatters';
import { runTrackedRequest, useRequestTracker } from '~/admin/request-tracker';
import { fetchAdminFileDetail, type OnAdminAccessLost } from '~/admin/transport';

export function FileInspection({
  fileId,
  onClose,
  onModerate,
  onAccessLost
}: {
  fileId: string;
  onClose: () => void;
  onModerate: (fileId: string, action: 'hide' | 'restore' | 'delete') => Promise<void>;
  onAccessLost: OnAdminAccessLost;
}) {
  const requestTracker = useRequestTracker();
  const [detail, setDetail] = useState<AdminFileDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    await runTrackedRequest({
      tracker: requestTracker,
      run: (signal) => fetchAdminFileDetail(fileId, signal),
      onSuccess: (res) => setDetail(res.file),
      onError: (err: unknown) => {
        if (err instanceof AdminAccessError) {
          onAccessLost(err);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load file detail.');
      },
      onFinally: () => setIsLoading(false)
    });
  }, [fileId, onAccessLost, requestTracker]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const handleModerate = async (action: 'hide' | 'restore' | 'delete') => {
    if (!confirmModerationAction(action, detail?.sanitizedFilename ?? 'this file')) {
      return;
    }

    setPendingAction(action);
    try {
      await onModerate(fileId, action);
      void loadDetail();
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

  if (isLoading) {
    return (
      <section className="panel panel--feature">
        <div className="panel__row">
          <p className="panel__label">File inspection</p>
          <button
            type="button"
            className="button-link button-link--ghost button-link--sm"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="state-empty">
          <strong>Loading file detail…</strong>
        </div>
      </section>
    );
  }

  if (error || !detail) {
    return (
      <section className="panel panel--feature">
        <div className="panel__row">
          <p className="panel__label">File inspection</p>
          <button
            type="button"
            className="button-link button-link--ghost button-link--sm"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="state-empty">
          <strong>Failed to load file.</strong>
          <p className="panel__copy">{error ?? 'Unknown error'}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel panel--feature">
      <div className="panel__row">
        <p className="panel__label">File inspection</p>
        <div className="report-card__chips">
          <span className="chip chip--outline">{formatFileStatus(detail.status)}</span>
          <button
            type="button"
            className="button-link button-link--ghost button-link--sm"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>

      <div className="admin-detail-stack">
        <article className="report-card report-card--selected">
          <div className="report-card__header">
            <div>
              <p className="surface-card__index">{detail.sanitizedFilename}</p>
              <h2>{formatFileStatus(detail.status)}</h2>
            </div>
            <span className="chip chip--outline">{formatCount(detail.reportCount)} reports</span>
          </div>

          <div className="admin-detail-grid">
            <div className="queue-card__stat">
              <span>Share token</span>
              <strong>{detail.token}</strong>
            </div>
            <div className="queue-card__stat">
              <span>MIME type</span>
              <strong>{detail.mimeType}</strong>
            </div>
            <div className="queue-card__stat">
              <span>Size</span>
              <strong>{formatBytes(detail.sizeBytes)}</strong>
            </div>
            <div className="queue-card__stat">
              <span>Uploaded</span>
              <strong>{formatDateTime(detail.uploadedAt)}</strong>
            </div>
            <div className="queue-card__stat">
              <span>Activated</span>
              <strong>{formatOptionalDateTime(detail.activatedAt)}</strong>
            </div>
            <div className="queue-card__stat">
              <span>Expires</span>
              <strong>{formatOptionalDateTime(detail.expiresAt)}</strong>
            </div>
            <div className="queue-card__stat">
              <span>Preview</span>
              <strong>{detail.allowPreview ? 'Allowed' : 'Blocked'}</strong>
            </div>
            <div className="queue-card__stat">
              <span>One-time</span>
              <strong>{detail.oneTimeDownload ? 'Enabled' : 'Disabled'}</strong>
            </div>
            <div className="queue-card__stat">
              <span>Storage object</span>
              <strong>{formatStorageObjectStatus(detail.storageObject.status)}</strong>
            </div>
            <div className="queue-card__stat">
              <span>Stored bytes</span>
              <strong>
                {detail.storageObject.contentLength === null
                  ? 'n/a'
                  : formatBytes(detail.storageObject.contentLength)}
              </strong>
            </div>
            <div className="queue-card__stat">
              <span>Consumed</span>
              <strong>{formatOptionalDateTime(detail.consumedAt)}</strong>
            </div>
            <div className="queue-card__stat">
              <span>Deleted</span>
              <strong>{formatOptionalDateTime(detail.deletedAt)}</strong>
            </div>
            <div className="queue-card__stat">
              <span>Storage check</span>
              <strong>{formatDateTime(detail.storageObject.checkedAt)}</strong>
            </div>
          </div>

          {detail.storageObject.error ? (
            <p className="panel__copy report-card__meta">
              Storage inspection degraded: {detail.storageObject.error}
            </p>
          ) : null}

          <div className="report-card__actions">
            {canHideFileStatus(detail.status) ? (
              <button
                type="button"
                className="button-link button-link--ghost button-link--sm"
                disabled={pendingAction !== null}
                onClick={() => handleModerate('hide')}
              >
                {pendingAction === 'hide' ? 'Saving…' : 'Hide'}
              </button>
            ) : null}
            {detail.status === 'hidden' ? (
              <button
                type="button"
                className="button-link button-link--sm"
                disabled={pendingAction !== null}
                onClick={() => handleModerate('restore')}
              >
                {pendingAction === 'restore' ? 'Saving…' : 'Restore'}
              </button>
            ) : null}
            {detail.status !== 'deleted' ? (
              <button
                type="button"
                className="button-link button-link--ghost button-link--sm"
                disabled={pendingAction !== null}
                onClick={() => handleModerate('delete')}
              >
                {pendingAction === 'delete' ? 'Saving…' : 'Delete'}
              </button>
            ) : null}
          </div>
        </article>

        <div className="admin-detail-grid admin-detail-grid--columns">
          <article className="report-card admin-detail-panel">
            <div className="report-card__header">
              <div>
                <p className="surface-card__index">Download activity</p>
                <h2>{formatCount(detail.downloadActivity.total)} events</h2>
              </div>
            </div>
            {detail.downloadActivity.recent.length === 0 ? (
              <div className="state-empty">
                <strong>No download events for this file yet.</strong>
              </div>
            ) : (
              <div className="admin-detail-list">
                {detail.downloadActivity.recent.map((event) => (
                  <article key={event.id} className="report-card report-card--compact">
                    <div className="report-card__header">
                      <div>
                        <p className="surface-card__index">{event.eventType}</p>
                        <h2>{formatDateTime(event.createdAt)}</h2>
                      </div>
                      <span className="chip chip--outline">
                        {event.ipHash ? `${event.ipHash.slice(0, 8)}…` : 'no IP hash'}
                      </span>
                    </div>
                    <dl className="detail-pairs">
                      <div className="detail-pairs__row">
                        <dt>File</dt>
                        <dd>{event.fileId}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            )}
          </article>

          <article className="report-card admin-detail-panel">
            <div className="report-card__header">
              <div>
                <p className="surface-card__index">Report trail</p>
                <h2>{formatCount(detail.reports.length)} reports</h2>
              </div>
            </div>
            {detail.reports.length === 0 ? (
              <div className="state-empty">
                <strong>No reports for this file.</strong>
              </div>
            ) : (
              <div className="admin-detail-list">
                {detail.reports.map((report) => (
                  <article key={report.id} className="report-card report-card--compact">
                    <div className="report-card__header">
                      <div>
                        <p className="surface-card__index">{formatReportReason(report.reason)}</p>
                        <h2>{report.status}</h2>
                      </div>
                      <div className="report-card__chips">
                        <span className={`chip chip--severity chip--severity-${report.urgency}`}>
                          {formatReportUrgency(report.urgency)}
                        </span>
                        <span className="chip chip--outline">
                          {formatDateTime(report.createdAt)}
                        </span>
                      </div>
                    </div>
                    <p className="panel__copy report-card__message">
                      {report.message?.trim() || 'No additional context.'}
                    </p>
                    <dl className="detail-pairs">
                      <div className="detail-pairs__row">
                        <dt>Resolved by</dt>
                        <dd>{report.resolvedBy ?? 'Pending'}</dd>
                      </div>
                      <div className="detail-pairs__row">
                        <dt>Resolved at</dt>
                        <dd>{formatOptionalDateTime(report.resolvedAt)}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            )}
          </article>

          <article className="report-card admin-detail-panel">
            <div className="report-card__header">
              <div>
                <p className="surface-card__index">Moderation history</p>
                <h2>{formatCount(detail.moderationHistory.length)} actions</h2>
              </div>
            </div>
            {detail.moderationHistory.length === 0 ? (
              <div className="state-empty">
                <strong>No moderation actions recorded.</strong>
              </div>
            ) : (
              <div className="admin-detail-list">
                {detail.moderationHistory.map((entry) => (
                  <article key={entry.id} className="report-card report-card--compact">
                    <div className="report-card__header">
                      <div>
                        <p className="surface-card__index">{entry.action}</p>
                        <h2>
                          {formatModerationTransition(entry.previousStatus, entry.nextStatus)}
                        </h2>
                      </div>
                      <span className="chip chip--outline">{formatDateTime(entry.createdAt)}</span>
                    </div>
                    <dl className="detail-pairs">
                      <div className="detail-pairs__row">
                        <dt>Actor</dt>
                        <dd>{entry.actorGithubLogin}</dd>
                      </div>
                      <div className="detail-pairs__row">
                        <dt>Reason</dt>
                        <dd>{entry.reason ?? 'No note.'}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            )}
          </article>
        </div>
      </div>
    </section>
  );
}
