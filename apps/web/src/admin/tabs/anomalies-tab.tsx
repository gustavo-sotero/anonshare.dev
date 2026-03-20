import {
  formatAnomalyType,
  formatDateTime,
  formatDetailValue,
  getAnomalyDetails
} from '~/admin/formatters';
import type { DashboardData } from '~/admin/transport';

export function AnomaliesTab({ data }: { data: DashboardData }) {
  return (
    <section className="panel">
      <div className="panel__row">
        <p className="panel__label">Anomaly backlog</p>
        <span className="chip chip--outline">
          {data.anomalies.length === 0 ? 'Clear' : `${data.anomalies.length} visible`}
        </span>
      </div>

      {data.anomalies.length === 0 ? (
        <div className="state-empty">
          <strong>No unresolved lifecycle anomalies.</strong>
          <p className="panel__copy">
            Reconciliation is not reporting any open storage or expiration mismatches right now.
          </p>
        </div>
      ) : (
        <div className="anomaly-list">
          {data.anomalies.map((anomaly) => (
            <article key={anomaly.id} className="anomaly-card">
              <div className="anomaly-card__header">
                <div>
                  <p className="surface-card__index">{formatAnomalyType(anomaly.type)}</p>
                  <h2>
                    {anomaly.fileId ? `File ${anomaly.fileId.slice(0, 8)}` : 'Storage-only anomaly'}
                  </h2>
                </div>
                <span className={`chip chip--severity chip--severity-${anomaly.severity}`}>
                  {anomaly.severity}
                </span>
              </div>
              <div className="anomaly-card__meta">
                <div className="queue-card__stat">
                  <span>Detected</span>
                  <strong>{formatDateTime(anomaly.detectedAt)}</strong>
                </div>
                <div className="queue-card__stat">
                  <span>Resolution</span>
                  <strong>{anomaly.resolution ?? 'Open'}</strong>
                </div>
              </div>
              {getAnomalyDetails(anomaly.details).length > 0 && (
                <dl className="detail-pairs">
                  {getAnomalyDetails(anomaly.details).map(([key, value]) => (
                    <div key={key} className="detail-pairs__row">
                      <dt>{key}</dt>
                      <dd>{formatDetailValue(value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
