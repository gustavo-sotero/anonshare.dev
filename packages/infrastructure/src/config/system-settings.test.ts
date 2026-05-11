import { describe, expect, mock, test } from 'bun:test';
import {
  getSystemSettingDefault,
  loadSystemSettingOrDefault,
  parseSystemSettingValue,
  parseSystemSettingValueByKey,
  readSystemSetting,
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

  test('emits a structured warning with reason=missing when the row is absent', async () => {
    const db = {
      query: {
        systemSettings: { findFirst: async () => null }
      }
    } as unknown as Parameters<typeof loadSystemSettingOrDefault>[0];
    const warnFn = mock(() => {});
    const log = { warn: warnFn };

    await loadSystemSettingOrDefault(db, 'uploadRateLimitPerHour', log);

    expect(warnFn).toHaveBeenCalledTimes(1);
    const [, ctx] = warnFn.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(ctx.event).toBe('system_settings.fallback');
    expect(ctx.key).toBe('upload_rate_limit_per_hour');
    expect(ctx.reason).toBe('missing');
  });

  test('emits a structured warning with reason=invalid_value when the stored value is bad', async () => {
    const db = {
      query: {
        systemSettings: {
          findFirst: async () => ({ key: 'report_rate_limit_per_hour', value: 'bad' })
        }
      }
    } as unknown as Parameters<typeof loadSystemSettingOrDefault>[0];
    const warnFn = mock(() => {});

    await loadSystemSettingOrDefault(db, 'reportRateLimitPerHour', { warn: warnFn });

    const [, ctx] = warnFn.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(ctx.reason).toBe('invalid_value');
    expect(ctx.key).toBe('report_rate_limit_per_hour');
  });

  test('emits a structured warning with reason=db_error when the query throws', async () => {
    const db = {
      query: {
        systemSettings: {
          findFirst: async () => {
            throw new Error('connection reset');
          }
        }
      }
    } as unknown as Parameters<typeof loadSystemSettingOrDefault>[0];
    const warnFn = mock(() => {});

    await loadSystemSettingOrDefault(db, 'reportAutoHideThreshold', { warn: warnFn });

    const [, ctx] = warnFn.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(ctx.reason).toBe('db_error');
    expect(typeof ctx.detail).toBe('string');
  });

  test('emits no warning when the value is read successfully', async () => {
    const db = {
      query: {
        systemSettings: {
          findFirst: async () => ({ key: 'upload_rate_limit_per_hour', value: '30' })
        }
      }
    } as unknown as Parameters<typeof loadSystemSettingOrDefault>[0];
    const warnFn = mock(() => {});

    await loadSystemSettingOrDefault(db, 'uploadRateLimitPerHour', { warn: warnFn });

    expect(warnFn).not.toHaveBeenCalled();
  });
});

describe('readSystemSetting', () => {
  test('returns degraded=false when the value is successfully read and parsed', async () => {
    const db = {
      query: {
        systemSettings: {
          findFirst: async () => ({ key: 'upload_rate_limit_per_hour', value: '25' })
        }
      }
    } as unknown as Parameters<typeof readSystemSetting>[0];

    const result = await readSystemSetting(db, 'uploadRateLimitPerHour');
    expect(result.degraded).toBe(false);
    expect(result.value).toBe(25);
  });

  test('returns degraded=true with reason=missing when the row is absent', async () => {
    const db = {
      query: { systemSettings: { findFirst: async () => null } }
    } as unknown as Parameters<typeof readSystemSetting>[0];

    const result = await readSystemSetting(db, 'reportRateLimitPerHour');
    expect(result.degraded).toBe(true);
    if (result.degraded) {
      expect(result.reason).toBe('missing');
      expect(result.value).toBe(10);
    }
  });

  test('returns degraded=true with reason=invalid_value when the stored value cannot be parsed', async () => {
    const db = {
      query: {
        systemSettings: {
          findFirst: async () => ({ key: 'download_rate_limit_per_minute', value: 'not-a-number' })
        }
      }
    } as unknown as Parameters<typeof readSystemSetting>[0];

    const result = await readSystemSetting(db, 'downloadRateLimitPerMinute');
    expect(result.degraded).toBe(true);
    if (result.degraded) {
      expect(result.reason).toBe('invalid_value');
      expect(result.value).toBe(30);
    }
  });

  test('returns degraded=true with reason=db_error when the query throws', async () => {
    const db = {
      query: {
        systemSettings: {
          findFirst: async () => {
            throw new Error('timeout');
          }
        }
      }
    } as unknown as Parameters<typeof readSystemSetting>[0];

    const result = await readSystemSetting(db, 'reportAutoHideThreshold');
    expect(result.degraded).toBe(true);
    if (result.degraded) {
      expect(result.reason).toBe('db_error');
      expect(typeof result.detail).toBe('string');
      expect(result.value).toBe(3);
    }
  });
});
