import { REPORT_AUTO_HIDE_THRESHOLD_DEFAULT } from '@anonshare/domain';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { systemSettings } from '../db/schema';

type NumericSystemSettingDefinition = {
  key: string;
  defaultValue: number;
};

export const SYSTEM_SETTING_DEFINITIONS = {
  reportAutoHideThreshold: {
    key: 'report_auto_hide_threshold',
    defaultValue: REPORT_AUTO_HIDE_THRESHOLD_DEFAULT
  },
  uploadRateLimitPerHour: {
    key: 'upload_rate_limit_per_hour',
    defaultValue: 20
  },
  reportRateLimitPerHour: {
    key: 'report_rate_limit_per_hour',
    defaultValue: 10
  },
  downloadRateLimitPerMinute: {
    key: 'download_rate_limit_per_minute',
    defaultValue: 30
  }
} as const satisfies Record<string, NumericSystemSettingDefinition>;

export type SystemSettingName = keyof typeof SYSTEM_SETTING_DEFINITIONS;
export type SystemSettingKey = (typeof SYSTEM_SETTING_DEFINITIONS)[SystemSettingName]['key'];

export type SystemSettingSeed = {
  key: SystemSettingKey;
  value: string;
};

function parsePositiveInteger(rawValue: string, key: string): number {
  const normalized = rawValue.trim();

  if (!/^\d+$/.test(normalized)) {
    throw new Error(`[system-settings] Invalid value for ${key}: expected a positive integer.`);
  }

  const parsed = Number(normalized);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`[system-settings] Invalid value for ${key}: expected a positive integer.`);
  }

  return parsed;
}

function findSystemSettingDefinitionByKey(key: SystemSettingKey): NumericSystemSettingDefinition {
  const definition = Object.values(SYSTEM_SETTING_DEFINITIONS).find(
    (candidate) => candidate.key === key
  );

  if (!definition) {
    throw new Error(`[system-settings] Unknown system setting key: ${key}`);
  }

  return definition;
}

export function getSystemSettingDefault(name: SystemSettingName): number {
  return SYSTEM_SETTING_DEFINITIONS[name].defaultValue;
}

export function parseSystemSettingValue(name: SystemSettingName, rawValue: string): number {
  return parsePositiveInteger(rawValue, SYSTEM_SETTING_DEFINITIONS[name].key);
}

export function parseSystemSettingValueByKey(key: SystemSettingKey, rawValue: string): number {
  return parsePositiveInteger(rawValue, findSystemSettingDefinitionByKey(key).key);
}

export function resolveSystemSetting(name: SystemSettingName, rawValue?: string | null): number {
  if (rawValue == null) {
    return getSystemSettingDefault(name);
  }

  return parseSystemSettingValue(name, rawValue);
}

export type SystemSettingFallbackReason = 'missing' | 'invalid_value' | 'db_error';

export type SystemSettingReadResult =
  | { value: number; degraded: false }
  | { value: number; degraded: true; reason: SystemSettingFallbackReason; detail?: string };

/**
 * Reads a system setting from the database and returns a structured result that
 * distinguishes a successful read from a fallback, and classifies the fallback reason.
 *
 * Never throws. The caller receives the default value regardless of why the fallback
 * occurred, but the `degraded` flag lets upstream code emit telemetry or surface the
 * failure in the admin dashboard.
 */
export async function readSystemSetting(
  db: Db,
  name: SystemSettingName
): Promise<SystemSettingReadResult> {
  const definition = SYSTEM_SETTING_DEFINITIONS[name];

  let rawValue: string | null | undefined;

  try {
    const row = await db.query.systemSettings.findFirst({
      where: eq(systemSettings.key, definition.key)
    });
    rawValue = row?.value;
  } catch (err) {
    return {
      value: getSystemSettingDefault(name),
      degraded: true,
      reason: 'db_error',
      detail: err instanceof Error ? err.message : String(err)
    };
  }

  if (rawValue == null) {
    return { value: getSystemSettingDefault(name), degraded: true, reason: 'missing' };
  }

  try {
    return { value: parseSystemSettingValue(name, rawValue), degraded: false };
  } catch (err) {
    return {
      value: getSystemSettingDefault(name),
      degraded: true,
      reason: 'invalid_value',
      detail: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Reads a system setting from the database and returns the numeric value, falling back
 * to the configured default on any error.  Emits a structured warning via the optional
 * `log` argument when a fallback is taken so operators can see the failure reason in
 * logs or admin telemetry without changing the business default behaviour.
 */
export async function loadSystemSettingOrDefault(
  db: Db,
  name: SystemSettingName,
  log?: { warn: (message: string, ctx: Record<string, unknown>) => void }
): Promise<number> {
  const result = await readSystemSetting(db, name);

  if (result.degraded) {
    const definition = SYSTEM_SETTING_DEFINITIONS[name];
    log?.warn('[system-settings] Falling back to default value', {
      event: 'system_settings.fallback',
      key: definition.key,
      reason: result.reason,
      ...(result.detail ? { detail: result.detail } : {})
    });
  }

  return result.value;
}

export const SYSTEM_SETTING_DEFAULTS: readonly SystemSettingSeed[] = Object.freeze(
  Object.values(SYSTEM_SETTING_DEFINITIONS).map((definition) => ({
    key: definition.key,
    value: String(definition.defaultValue)
  }))
);
