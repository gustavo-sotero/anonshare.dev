import { describe, expect, test } from 'bun:test';
import {
  getSystemSettingDefault,
  loadSystemSettingOrDefault,
  parseSystemSettingValue,
  parseSystemSettingValueByKey,
  resolveSystemSetting,
  SYSTEM_SETTING_DEFAULTS,
  SYSTEM_SETTING_DEFINITIONS
} from './system-settings';

describe('SYSTEM_SETTING_DEFINITIONS', () => {
  test('exposes the canonical operational defaults used by seed and runtime readers', () => {
    expect(SYSTEM_SETTING_DEFINITIONS.reportAutoHideThreshold).toEqual({
      key: 'report_auto_hide_threshold',
      defaultValue: 3
    });
    expect(SYSTEM_SETTING_DEFINITIONS.uploadRateLimitPerHour).toEqual({
      key: 'upload_rate_limit_per_hour',
      defaultValue: 20
    });
    expect(SYSTEM_SETTING_DEFINITIONS.reportRateLimitPerHour).toEqual({
      key: 'report_rate_limit_per_hour',
      defaultValue: 10
    });
    expect(SYSTEM_SETTING_DEFINITIONS.downloadRateLimitPerMinute).toEqual({
      key: 'download_rate_limit_per_minute',
      defaultValue: 30
    });
  });

  test('produces a unique seed row for each configured setting', () => {
    const keys = SYSTEM_SETTING_DEFAULTS.map((setting) => setting.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(SYSTEM_SETTING_DEFAULTS).toEqual([
      { key: 'report_auto_hide_threshold', value: '3' },
      { key: 'upload_rate_limit_per_hour', value: '20' },
      { key: 'report_rate_limit_per_hour', value: '10' },
      { key: 'download_rate_limit_per_minute', value: '30' }
    ]);
  });
});

describe('system setting parsing', () => {
  test('returns numeric defaults when a value is absent', () => {
    expect(getSystemSettingDefault('reportAutoHideThreshold')).toBe(3);
    expect(resolveSystemSetting('uploadRateLimitPerHour')).toBe(20);
    expect(resolveSystemSetting('reportRateLimitPerHour', null)).toBe(10);
  });

  test('parses positive integers from stored values', () => {
    expect(parseSystemSettingValue('downloadRateLimitPerMinute', '45')).toBe(45);
    expect(parseSystemSettingValueByKey('report_auto_hide_threshold', '7')).toBe(7);
    expect(resolveSystemSetting('reportAutoHideThreshold', '9')).toBe(9);
  });

  test('rejects malformed values instead of silently accepting invalid config', () => {
    expect(() => parseSystemSettingValue('uploadRateLimitPerHour', '0')).toThrow(
      'upload_rate_limit_per_hour'
    );
    expect(() => parseSystemSettingValueByKey('download_rate_limit_per_minute', '-1')).toThrow(
      'download_rate_limit_per_minute'
    );
    expect(() => resolveSystemSetting('reportRateLimitPerHour', 'abc')).toThrow(
      'report_rate_limit_per_hour'
    );
  });
});

describe('loadSystemSettingOrDefault', () => {
  test('returns the stored value when the settings row exists', async () => {
    const db = {
      query: {
        systemSettings: {
          findFirst: async () => ({ key: 'upload_rate_limit_per_hour', value: '45' })
        }
      }
    } as unknown as Parameters<typeof loadSystemSettingOrDefault>[0];

    await expect(loadSystemSettingOrDefault(db, 'uploadRateLimitPerHour')).resolves.toBe(45);
  });

  test('falls back to the default when the settings row is missing', async () => {
    const db = {
      query: {
        systemSettings: {
          findFirst: async () => null
        }
      }
    } as unknown as Parameters<typeof loadSystemSettingOrDefault>[0];

    await expect(loadSystemSettingOrDefault(db, 'reportRateLimitPerHour')).resolves.toBe(10);
  });

  test('falls back to the default when the stored value is invalid', async () => {
    const db = {
      query: {
        systemSettings: {
          findFirst: async () => ({ key: 'download_rate_limit_per_minute', value: 'abc' })
        }
      }
    } as unknown as Parameters<typeof loadSystemSettingOrDefault>[0];

    await expect(loadSystemSettingOrDefault(db, 'downloadRateLimitPerMinute')).resolves.toBe(30);
  });

  test('falls back to the default when the query throws', async () => {
    const db = {
      query: {
        systemSettings: {
          findFirst: async () => {
            throw new Error('query failed');
          }
        }
      }
    } as unknown as Parameters<typeof loadSystemSettingOrDefault>[0];

    await expect(loadSystemSettingOrDefault(db, 'reportAutoHideThreshold')).resolves.toBe(3);
  });
});
