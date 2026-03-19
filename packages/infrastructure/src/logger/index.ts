/**
 * Structured logger.
 *
 * Emits JSON in production/test and a human-readable format in development.
 * All events carry a minimum set of fields for correlation:
 *   - timestamp (ISO-8601)
 *   - level
 *   - service  (process identifier: "api" | "worker" | "web")
 *   - event  (stable machine-readable event id, e.g. "http_request_completed" or "upload.created")
 *   - message (human-readable description)
 *   - requestId (optional — set per-request by middleware)
 *   - actor (optional — "anonymous" | "admin" | "worker" | "system")
 *   - entity (optional — { type, id })
 *   - outcome (optional — "success" | "failure")
 *   - ...rest (additional context fields)
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

type LogContext = {
  event?: string;
  service?: string;
  requestId?: string;
  actor?: string;
  entity?: { type: string; id: string };
  outcome?: 'success' | 'failure';
  [key: string]: unknown;
};

type Logger = {
  debug: (message: string, ctx?: LogContext) => void;
  info: (message: string, ctx?: LogContext) => void;
  warn: (message: string, ctx?: LogContext) => void;
  error: (message: string, ctx?: LogContext) => void;
  /** Create a child logger that merges `defaults` into every emitted entry. */
  withContext: (defaults: LogContext) => Logger;
};

function isDev(): boolean {
  return (process.env.NODE_ENV ?? 'development') === 'development';
}

function formatDev(level: Level, message: string, ctx: LogContext): string {
  const prefix = {
    debug: '[\x1b[90mDEBUG\x1b[0m]',
    info: '[\x1b[36mINFO\x1b[0m] ',
    warn: '[\x1b[33mWARN\x1b[0m] ',
    error: '[\x1b[31mERROR\x1b[0m]'
  }[level];

  const svc = ctx.service ? `\x1b[35m${ctx.service}\x1b[0m ` : '';
  const event = ctx.event ? `\x1b[90m${ctx.event}\x1b[0m ` : '';
  const rest = { ...ctx };
  delete rest.event;
  delete rest.service;

  const extra = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';

  return `${prefix} ${svc}${event}${message}${extra}`;
}

function emit(level: Level, message: string, ctx: LogContext = {}): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...ctx
  };

  const output = isDev() ? formatDev(level, message, ctx) : JSON.stringify(entry);

  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

function createLogger(defaults: LogContext = {}): Logger {
  function merge(ctx?: LogContext): LogContext {
    if (!ctx) return defaults;
    return { ...defaults, ...ctx };
  }

  return {
    debug: (message: string, ctx?: LogContext) => emit('debug', message, merge(ctx)),
    info: (message: string, ctx?: LogContext) => emit('info', message, merge(ctx)),
    warn: (message: string, ctx?: LogContext) => emit('warn', message, merge(ctx)),
    error: (message: string, ctx?: LogContext) => emit('error', message, merge(ctx)),
    withContext: (extra: LogContext) => createLogger({ ...defaults, ...extra })
  };
}

export const logger: Logger = createLogger();

export type { LogContext, Logger };
