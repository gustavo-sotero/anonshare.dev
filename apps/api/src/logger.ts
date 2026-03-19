import { logger as baseLogger } from '@anonshare/infrastructure/logger';

type LogContext = Parameters<typeof baseLogger.info>[1];

function withApiService(context?: LogContext): LogContext {
  return {
    ...context,
    service: 'api'
  };
}

export const logger = {
  debug(message: string, context?: LogContext): void {
    baseLogger.debug(message, withApiService(context));
  },
  info(message: string, context?: LogContext): void {
    baseLogger.info(message, withApiService(context));
  },
  warn(message: string, context?: LogContext): void {
    baseLogger.warn(message, withApiService(context));
  },
  error(message: string, context?: LogContext): void {
    baseLogger.error(message, withApiService(context));
  }
};
