import { describe, expect, test } from 'bun:test';
import {
  DOWNLOAD_EVENT_TYPE_VALUES,
  FILE_MODERATION_ACTION_VALUES,
  OPERATIONAL_ANOMALY_SEVERITY_VALUES,
  OPERATIONAL_ANOMALY_TYPE_VALUES,
  REPORT_RESOLUTION_ACTION_VALUES,
  type SharedFile,
  SYSTEM_JOB_NAME_VALUES
} from './entities';

describe('domain entity value registries', () => {
  test('exports canonical download event types', () => {
    expect(DOWNLOAD_EVENT_TYPE_VALUES).toEqual(['started', 'completed', 'failed', 'blocked']);
  });

  test('exports canonical operational anomaly types', () => {
    expect(OPERATIONAL_ANOMALY_TYPE_VALUES).toEqual([
      'missing_object',
      'orphaned_object',
      'stale_expiration',
      'failed_cleanup',
      'lifecycle_job_overdue',
      'lifecycle_job_duplicate',
      'reconciliation_scan_incomplete'
    ]);
  });

  test('exports canonical operational anomaly severities', () => {
    expect(OPERATIONAL_ANOMALY_SEVERITY_VALUES).toEqual(['low', 'medium', 'high']);
  });

  test('exports canonical moderation action values', () => {
    expect(FILE_MODERATION_ACTION_VALUES).toEqual(['hide', 'restore', 'delete']);
    expect(REPORT_RESOLUTION_ACTION_VALUES).toEqual(['resolved', 'dismissed']);
  });

  test('exports canonical system job names', () => {
    expect(SYSTEM_JOB_NAME_VALUES).toEqual([
      'expire_file',
      'cleanup_file',
      'auto_hide_file',
      'reconcile'
    ]);
  });
});

describe('SharedFile', () => {
  test('captures the module 2 core file metadata shape', () => {
    const record: SharedFile = {
      id: crypto.randomUUID(),
      token: 'abc123DEF456_ghi-jkl',
      objectKey: 'uploads/example/report.pdf',
      originalFilename: 'report.pdf',
      sanitizedFilename: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      status: 'active',
      policy: {
        allowPreview: true,
        oneTimeDownload: false,
        expiresAt: null
      },
      uploadedAt: new Date(),
      activatedAt: new Date(),
      consumedAt: null,
      deletedAt: null,
      reportCount: 0
    };

    expect(record.policy.allowPreview).toBe(true);
    expect(record.status).toBe('active');
  });
});
