import { validateApiEnv } from '@anonshare/infrastructure/config';
import { logger } from '@anonshare/infrastructure/logger';
import { createApiApp } from './app';

const config = validateApiEnv();
const app = createApiApp();

// ─── Boot ────────────────────────────────────────────────────────────────────

const port = config.port;

logger.info('API starting', {
  actor: 'system',
  event: 'api_start',
  outcome: 'success',
  port
});

export default {
  port,
  fetch: app.fetch
};
