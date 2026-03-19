import { describe, expect, test } from 'bun:test';
import { buildSharePageHead } from '../routes/share.$token';

describe('buildSharePageHead', () => {
  test('marks share pages as noindex and uses the file name when metadata exists', () => {
    const head = buildSharePageHead({
      ok: true,
      status: 200,
      data: {
        shareToken: 'Abc123defghijkl012',
        filename: 'notes.txt',
        mimeType: 'text/plain',
        sizeBytes: 128,
        status: 'active',
        oneTime: false,
        allowPreview: true,
        expiresAt: null,
        createdAt: '2026-03-18T12:00:00.000Z'
      },
      errorCode: null
    });

    expect(head.meta).toContainEqual({ title: 'notes.txt — anonshare' });
    expect(head.meta).toContainEqual({ name: 'robots', content: 'noindex, nofollow' });
  });

  test('falls back to the generic share title when metadata is unavailable', () => {
    const head = buildSharePageHead();

    expect(head.meta).toContainEqual({ title: 'anonshare — file link' });
    expect(head.meta).toContainEqual({ name: 'robots', content: 'noindex, nofollow' });
  });
});