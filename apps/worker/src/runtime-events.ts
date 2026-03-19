export type WorkerLifecycleEvent = 'worker_ready' | 'worker_shutdown' | 'worker_start';

export type WorkerJobEvent = 'job_completed' | 'job_failed';

export type WorkerJobTelemetry = {
  attemptsMade?: number;
  delay?: number;
  finishedOn?: number;
  id?: string;
  name?: string;
  processedOn?: number;
  timestamp?: number;
};

function getJobLagMs(job: WorkerJobTelemetry): number {
  const scheduledAt = (job.timestamp ?? Date.now()) + (job.delay ?? 0);
  const processedAt = job.processedOn ?? Date.now();
  return Math.max(0, processedAt - scheduledAt);
}

function getJobDurationMs(job: WorkerJobTelemetry): number | null {
  if (typeof job.processedOn !== 'number' || typeof job.finishedOn !== 'number') {
    return null;
  }

  return Math.max(0, job.finishedOn - job.processedOn);
}

export function buildWorkerLifecycleLog(event: WorkerLifecycleEvent) {
  return {
    actor: 'worker' as const,
    event,
    outcome: 'success' as const
  };
}

export function buildWorkerJobLogContext({
  error,
  event,
  job,
  queue
}: {
  error?: string;
  event: WorkerJobEvent;
  job?: WorkerJobTelemetry | null | undefined;
  queue: string;
}) {
  return {
    actor: 'worker' as const,
    ...(job ? { entity: { type: 'job', id: job.id ?? 'unknown' } } : {}),
    ...(error ? { error } : {}),
    event,
    outcome: event === 'job_completed' ? ('success' as const) : ('failure' as const),
    queue,
    jobName: job?.name,
    attemptsMade: job?.attemptsMade ?? 0,
    lagMs: job ? getJobLagMs(job) : null,
    durationMs: job ? getJobDurationMs(job) : null
  };
}
