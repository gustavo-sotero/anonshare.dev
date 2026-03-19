import { MAX_FILE_SIZE_BYTES } from '@anonshare/domain';
import { validateApiEnv } from '@anonshare/infrastructure/config';
import { createApiApp } from './app';
import { logger } from './logger';

const config = validateApiEnv();
const app = createApiApp();

// ─── Boot ────────────────────────────────────────────────────────────────────

const port = config.port;

logger.info('API starting', {
  actor: 'system',
  event: 'api_start',
  service: 'api',
  outcome: 'success',
  port
});

export default {
  port,
  // Cap body buffering at the transport layer — consistent with the pre-flight
  // and per-file size checks in the upload handler (256 MB + ~64 KiB overhead).
  maxRequestBodySize: MAX_FILE_SIZE_BYTES + 65_536,
  fetch: app.fetch
};
