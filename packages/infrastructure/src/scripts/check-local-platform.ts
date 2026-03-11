import { deriveLocalPlatformEnv } from '../config/index';
import { checkPlatformHealth, evaluatePlatformHealth } from '../health/index';
import { logger } from '../logger/index';

deriveLocalPlatformEnv();

logger.info('Checking local platform dependencies', {
  actor: 'system',
  event: 'local_platform_check_start',
  outcome: 'success'
});

const results = await checkPlatformHealth();
const summary = evaluatePlatformHealth(results);

for (const result of results) {
  const log = result.ok ? logger.info : logger.error;

  log(result.ok ? 'Dependency healthy' : 'Dependency unhealthy', {
    actor: 'system',
    event: result.ok ? 'local_dependency_healthy' : 'local_dependency_unhealthy',
    entity: { type: 'dependency', id: result.dependency },
    outcome: result.ok ? 'success' : 'failure',
    durationMs: result.durationMs,
    ...(result.details ? { details: result.details } : {})
  });
}

if (!summary.ok) {
  logger.error('Local platform validation failed', {
    actor: 'system',
    event: 'local_platform_check_failed',
    outcome: 'failure'
  });
  process.exit(1);
}

logger.info('Local platform validation passed', {
  actor: 'system',
  event: 'local_platform_check_passed',
  outcome: 'success'
});
