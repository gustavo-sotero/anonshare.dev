import { describe, expect, it } from 'bun:test';
import type { AdminFileSummary, AdminOverviewResponse } from '@anonshare/contracts';
import {
  buildStorageHighlights,
  canHideFileStatus,
  getModerationConfirmationMessage
} from './dashboard';

function makeOverview(overrides: Partial<AdminOverviewResponse> = {}): AdminOverviewResponse {
  return {
    totalFiles: 8,
    byStatus: {
      active: 2,
      expiring: 1,
      expired: 2,
      hidden: 1,
      deleted: 1,
      consumed: 1
    },
    totalStorageBytes: 4096,
    totalDownloads: 12,
    ...overrides
  };
}

function makeFile(overrides: Partial<AdminFileSummary> = {}): AdminFileSummary {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    token: 'share-token',
    sanitizedFilename: 'report.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    status: 'active',
    reportCount: 0,
    allowPreview: true,
    oneTimeDownload: false,
    expiresAt: null,
    uploadedAt: '2026-03-18T12:00:00.000Z',
    activatedAt: '2026-03-18T12:05:00.000Z',
    consumedAt: null,
    deletedAt: null,
    ...overrides
  };
}

describe('getModerationConfirmationMessage', () => {
  it('requires confirmation for hide and delete actions', () => {
    expect(getModerationConfirmationMessage('hide', 'report.pdf')).toBe(
      'Hide report.pdf? This immediately blocks public downloads and previews.'
    );
    expect(getModerationConfirmationMessage('delete', 'report.pdf')).toBe(
      'Delete report.pdf? This immediately removes public access and schedules storage cleanup.'
    );
  });

  it('does not require confirmation for restore', () => {
    expect(getModerationConfirmationMessage('restore', 'report.pdf')).toBeNull();
  });
});

describe('buildStorageHighlights', () => {
  it('summarizes active, non-public, and largest-file storage context', () => {
    const overview = makeOverview();
    const files = [
      makeFile({ id: '00000000-0000-4000-8000-000000000010', sanitizedFilename: 'archive.zip' }),
      makeFile({ id: '00000000-0000-4000-8000-000000000011', sanitizedFilename: 'clip.mp4' })
    ];
    const largestFile = files[0];

    if (!largestFile) {
      throw new Error('Expected at least one file in the ranking.');
    }

    expect(buildStorageHighlights(overview, files)).toEqual({
      totalStorageBytes: 4096,
      activeFileCount: 3,
      nonPublicFileCount: 5,
      largestFile
    });
  });

  it('returns null when no ranked files are loaded yet', () => {
    expect(buildStorageHighlights(makeOverview(), []).largestFile).toBeNull();
  });
});

describe('canHideFileStatus', () => {
  it('allows hide for active and expiring files', () => {
    expect(canHideFileStatus('active')).toBe(true);
    expect(canHideFileStatus('expiring')).toBe(true);
  });

  it('disallows hide for non-public lifecycle states', () => {
    expect(canHideFileStatus('pending_upload')).toBe(false);
    expect(canHideFileStatus('expired')).toBe(false);
    expect(canHideFileStatus('hidden')).toBe(false);
    expect(canHideFileStatus('deleted')).toBe(false);
    expect(canHideFileStatus('consumed')).toBe(false);
    expect(canHideFileStatus('missing')).toBe(false);
  });
});
