import { QueueCard } from '~/admin/tabs/queue-card';
import type { DashboardData } from '~/admin/transport';

export function QueuesTab({ data }: { data: DashboardData }) {
  return (
    <section className="panel">
      <div className="panel__row">
        <p className="panel__label">Queue health</p>
        <span className="chip chip--outline">{data.stats.queueHealth.length} queues</span>
      </div>
      <div className="surface-grid surface-grid--narrow admin-queue-grid">
        {data.stats.queueHealth.map((queue) => (
          <QueueCard key={queue.queue} queue={queue} />
        ))}
      </div>
    </section>
  );
}
