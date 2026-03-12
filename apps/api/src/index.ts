import { MAX_FILE_SIZE_BYTES } from '@anonshare/domain';
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
  // Cap body buffering at the transport layer — consistent with the pre-flight
  // and per-file size checks in the upload handler (256 MB + ~64 KiB overhead).
  maxRequestBodySize: MAX_FILE_SIZE_BYTES + 65_536,
  fetch: app.fetch
};
