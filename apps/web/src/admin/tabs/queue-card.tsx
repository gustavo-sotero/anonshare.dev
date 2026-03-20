import type { QueueHealthSnapshot } from '@anonshare/contracts';
import {
  formatCount,
  formatDuration,
  formatLag,
  formatPercent,
  summarizeQueueState
} from '~/admin/formatters';

export function QueueCard({ queue }: { queue: QueueHealthSnapshot }) {
  return (
    <article className="surface-card queue-card">
      <div className="queue-card__header">
        <div>
          <p className="surface-card__index">{queue.queue}</p>
          <h2>{summarizeQueueState(queue)}</h2>
        </div>
        <span className="chip chip--outline">
          {queue.status === 'degraded' ? 'Telemetry degraded' : `Lag ${formatLag(queue.lagMs)}`}
        </span>
      </div>

      {queue.status === 'degraded' && queue.lastError ? (
        <p className="panel__copy">Queue telemetry is temporarily unavailable: {queue.lastError}</p>
      ) : null}

      <div className="queue-card__stats">
        <div className="queue-card__stat">
          <span>Waiting</span>
          <strong>{formatCount(queue.waiting)}</strong>
        </div>
        <div className="queue-card__stat">
          <span>Active</span>
          <strong>{formatCount(queue.active)}</strong>
        </div>
        <div className="queue-card__stat">
          <span>Delayed</span>
          <strong>{formatCount(queue.delayed)}</strong>
        </div>
        <div className="queue-card__stat">
          <span>Failed</span>
          <strong>{formatCount(queue.failed)}</strong>
        </div>
        <div className="queue-card__stat">
          <span>Completed</span>
          <strong>{formatCount(queue.completed)}</strong>
        </div>
        <div className="queue-card__stat">
          <span>Avg duration</span>
          <strong>{formatDuration(queue.processing.avgDurationMs)}</strong>
        </div>
        <div className="queue-card__stat">
          <span>P95 duration</span>
          <strong>{formatDuration(queue.processing.p95DurationMs)}</strong>
        </div>
        <div className="queue-card__stat">
          <span>Retry rate</span>
          <strong>{formatPercent(queue.processing.retryRate)}</strong>
        </div>
      </div>
    </article>
  );
}
