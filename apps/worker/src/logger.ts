import { logger as baseLogger } from '@anonshare/infrastructure/logger';

type LogContext = Parameters<typeof baseLogger.info>[1];

function withWorkerService(context?: LogContext): LogContext {
  return {
    ...context,
    service: 'worker'
  };
}

export const logger = {
  debug(message: string, context?: LogContext): void {
    baseLogger.debug(message, withWorkerService(context));
  },
  info(message: string, context?: LogContext): void {
    baseLogger.info(message, withWorkerService(context));
  },
  warn(message: string, context?: LogContext): void {
    baseLogger.warn(message, withWorkerService(context));
  },
  error(message: string, context?: LogContext): void {
    baseLogger.error(message, withWorkerService(context));
  }
};
