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

export async function loadSystemSettingOrDefault(db: Db, name: SystemSettingName): Promise<number> {
  const definition = SYSTEM_SETTING_DEFINITIONS[name];

  try {
    const row = await db.query.systemSettings.findFirst({
      where: eq(systemSettings.key, definition.key)
    });

    return resolveSystemSetting(name, row?.value);
  } catch {
    return getSystemSettingDefault(name);
  }
}

export const SYSTEM_SETTING_DEFAULTS: readonly SystemSettingSeed[] = Object.freeze(
  Object.values(SYSTEM_SETTING_DEFINITIONS).map((definition) => ({
    key: definition.key,
    value: String(definition.defaultValue)
  }))
);
