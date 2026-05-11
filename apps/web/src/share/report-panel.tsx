import { reportReasonValues } from '@anonshare/contracts';
import type { ReportReason } from '~/share/page-state';

const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  illegal_content: 'Illegal content',
  copyright_violation: 'Copyright violation',
  malware: 'Malware or phishing',
  spam: 'Spam',
  other: 'Other'
};

export type ReportPhase = 'idle' | 'submitting' | 'success' | 'error';

export type PublicReportPanelProps = {
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
};

export function PublicReportPanel({
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
}: PublicReportPanelProps) {
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
            <div className="report-form__field">
              <label htmlFor="report-reason" className="report-form__label">
                Reason
              </label>
              <select
                id="report-reason"
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
            </div>
            <div className="report-form__field">
              <label htmlFor="report-message" className="report-form__label">
                Additional context <span className="report-form__optional">(optional)</span>
              </label>
              <textarea
                id="report-message"
                className="report-form__textarea"
                value={reportMessage}
                onChange={(e) => onMessageChange(e.target.value.slice(0, 1000))}
                placeholder="Describe the issue briefly."
                rows={3}
                disabled={reportPhase === 'submitting'}
              />
            </div>
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
