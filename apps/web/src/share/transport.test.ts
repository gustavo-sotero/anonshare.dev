import { afterEach, describe, expect, it } from 'bun:test';
import {
  fetchDownloadUrl,
  fetchPreviewUrl,
  fetchShareMeta,
  refreshShareAvailability,
  submitShareReport
} from './transport';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_TOKEN = 'AAABBBCCCDDDEEEFFF123456';

const VALID_FILE_META = {
  shareToken: VALID_TOKEN,
  filename: 'example.png',
  mimeType: 'image/png',
  sizeBytes: 1024,
  status: 'active',
  oneTime: false,
  allowPreview: false,
  expiresAt: null,
  createdAt: '2026-05-08T12:00:00.000Z'
};

const VALID_DOWNLOAD_URL = {
  url: 'https://storage.example.com/dl/object-key',
  expiresAt: '2026-05-08T13:00:00.000Z'
};

const VALID_PREVIEW_URL = {
  url: 'https://storage.example.com/preview/object-key',
  expiresAt: '2026-05-08T13:00:00.000Z',
  mimeType: 'image/png'
};

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function makeSuccessEnvelope(data: unknown): unknown {
  return { ok: true, data };
}

function makeErrorEnvelope(code: string, message: string): unknown {
  return { ok: false, error: { code, message } };
}

// ─── fetchShareMeta ───────────────────────────────────────────────────────────

describe('fetchShareMeta', () => {
  it('returns ok=true with parsed file metadata on a 200 success envelope', async () => {
    globalThis.fetch = (async () =>
      makeJsonResponse(makeSuccessEnvelope(VALID_FILE_META))) as unknown as typeof fetch;

    const result = await fetchShareMeta('/api', VALID_TOKEN);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.shareToken).toBe(VALID_TOKEN);
    expect(result.data.filename).toBe('example.png');
    expect(result.data.status).toBe('active');
  });

  it('passes the AbortSignal to fetch', async () => {
    let capturedSignal: AbortSignal | null | undefined;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      capturedSignal = init?.signal ?? null;
      return makeJsonResponse(makeSuccessEnvelope(VALID_FILE_META));
    }) as unknown as typeof fetch;

    const controller = new AbortController();
    await fetchShareMeta('/api', VALID_TOKEN, controller.signal);

    expect(capturedSignal).toBe(controller.signal);
  });

  it('returns ok=false with the API error code on a 4xx error envelope', async () => {
    globalThis.fetch = (async () =>
      makeJsonResponse(
        makeErrorEnvelope('not_found', 'File not found.'),
        404
      )) as unknown as typeof fetch;

    const result = await fetchShareMeta('/api', VALID_TOKEN);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected err');
    expect(result.status).toBe(404);
    expect(result.code).toBe('not_found');
    expect(result.message).toBe('File not found.');
  });

  it('returns ok=false with file_unavailable when the response body is not valid JSON', async () => {
    globalThis.fetch = (async () =>
      new Response('not json', { status: 200 })) as unknown as typeof fetch;

    const result = await fetchShareMeta('/api', VALID_TOKEN);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected err');
    expect(result.code).toBe('file_unavailable');
  });

  it('returns ok=false with file_unavailable when the 200 body does not match the schema', async () => {
    globalThis.fetch = (async () =>
      makeJsonResponse(makeSuccessEnvelope({ invalid: true }))) as unknown as typeof fetch;

    const result = await fetchShareMeta('/api', VALID_TOKEN);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected err');
    expect(result.code).toBe('file_unavailable');
    expect(result.message).toBe('Unexpected response format.');
  });

  it('returns ok=false with file_unavailable when the 4xx body is not a recognizable error envelope', async () => {
    globalThis.fetch = (async () =>
      makeJsonResponse({ unexpected: 'shape' }, 500)) as unknown as typeof fetch;

    const result = await fetchShareMeta('/api', VALID_TOKEN);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected err');
    expect(result.status).toBe(500);
    expect(result.code).toBe('file_unavailable');
  });
});

// ─── fetchDownloadUrl ─────────────────────────────────────────────────────────

describe('fetchDownloadUrl', () => {
  it('returns ok=true with the download URL on a 200 success envelope', async () => {
    globalThis.fetch = (async () =>
      makeJsonResponse(makeSuccessEnvelope(VALID_DOWNLOAD_URL))) as unknown as typeof fetch;

    const result = await fetchDownloadUrl(VALID_TOKEN);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.url).toBe('https://storage.example.com/dl/object-key');
  });

  it('passes the AbortSignal to fetch', async () => {
    let capturedSignal: AbortSignal | null | undefined;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      capturedSignal = init?.signal ?? null;
      return makeJsonResponse(makeSuccessEnvelope(VALID_DOWNLOAD_URL));
    }) as unknown as typeof fetch;

    const controller = new AbortController();
    await fetchDownloadUrl(VALID_TOKEN, controller.signal);

    expect(capturedSignal).toBe(controller.signal);
  });

  it('returns ok=false with the error code on a 410 gone response', async () => {
    globalThis.fetch = (async () =>
      makeJsonResponse(
        makeErrorEnvelope('file_consumed', 'This one-time link has already been used.'),
        410
      )) as unknown as typeof fetch;

    const result = await fetchDownloadUrl(VALID_TOKEN);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected err');
    expect(result.status).toBe(410);
    expect(result.code).toBe('file_consumed');
  });
});

// ─── fetchPreviewUrl ──────────────────────────────────────────────────────────

describe('fetchPreviewUrl', () => {
  it('returns ok=true with the preview URL and MIME type on success', async () => {
    globalThis.fetch = (async () =>
      makeJsonResponse(makeSuccessEnvelope(VALID_PREVIEW_URL))) as unknown as typeof fetch;

    const result = await fetchPreviewUrl(VALID_TOKEN);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.url).toBe('https://storage.example.com/preview/object-key');
    expect(result.data.mimeType).toBe('image/png');
  });

  it('passes the AbortSignal to fetch', async () => {
    let capturedSignal: AbortSignal | null | undefined;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      capturedSignal = init?.signal ?? null;
      return makeJsonResponse(makeSuccessEnvelope(VALID_PREVIEW_URL));
    }) as unknown as typeof fetch;

    const controller = new AbortController();
    await fetchPreviewUrl(VALID_TOKEN, controller.signal);

    expect(capturedSignal).toBe(controller.signal);
  });

  it('returns ok=false with the error code on a 403 forbidden response', async () => {
    globalThis.fetch = (async () =>
      makeJsonResponse(
        makeErrorEnvelope('file_unavailable', 'Preview is not available for this file.'),
        403
      )) as unknown as typeof fetch;

    const result = await fetchPreviewUrl(VALID_TOKEN);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected err');
    expect(result.status).toBe(403);
    expect(result.code).toBe('file_unavailable');
  });
});

// ─── refreshShareAvailability ─────────────────────────────────────────────────

describe('refreshShareAvailability', () => {
  it('returns ok=true with refreshed metadata on a 200 success envelope', async () => {
    globalThis.fetch = (async () =>
      makeJsonResponse(makeSuccessEnvelope(VALID_FILE_META))) as unknown as typeof fetch;

    const result = await refreshShareAvailability(VALID_TOKEN);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.shareToken).toBe(VALID_TOKEN);
  });

  it('passes the AbortSignal to fetch', async () => {
    let capturedSignal: AbortSignal | null | undefined;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      capturedSignal = init?.signal ?? null;
      return makeJsonResponse(makeSuccessEnvelope(VALID_FILE_META));
    }) as unknown as typeof fetch;

    const controller = new AbortController();
    await refreshShareAvailability(VALID_TOKEN, controller.signal);

    expect(capturedSignal).toBe(controller.signal);
  });

  it('returns ok=false with the error code when the file has since been consumed', async () => {
    globalThis.fetch = (async () =>
      makeJsonResponse(
        makeErrorEnvelope('file_consumed', 'This one-time link has already been used.'),
        410
      )) as unknown as typeof fetch;

    const result = await refreshShareAvailability(VALID_TOKEN);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected err');
    expect(result.code).toBe('file_consumed');
  });
});

// ─── submitShareReport ────────────────────────────────────────────────────────

describe('submitShareReport', () => {
  it('returns ok=true when the report is accepted', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;

    const result = await submitShareReport(VALID_TOKEN, 'spam', null);

    expect(result.ok).toBe(true);
  });

  it('includes the optional message in the request body when provided', async () => {
    let capturedBody: unknown;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      capturedBody = init?.body ? JSON.parse(init.body as string) : null;
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    await submitShareReport(VALID_TOKEN, 'spam', 'Suspicious payload');

    expect(capturedBody).toMatchObject({ reason: 'spam', message: 'Suspicious payload' });
  });

  it('omits the message field when message is null', async () => {
    let capturedBody: unknown;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      capturedBody = init?.body ? JSON.parse(init.body as string) : null;
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    await submitShareReport(VALID_TOKEN, 'other', null);

    expect(capturedBody).not.toHaveProperty('message');
  });

  it('passes the AbortSignal to fetch', async () => {
    let capturedSignal: AbortSignal | null | undefined;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      capturedSignal = init?.signal ?? null;
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const controller = new AbortController();
    await submitShareReport(VALID_TOKEN, 'other', null, controller.signal);

    expect(capturedSignal).toBe(controller.signal);
  });

  it('returns ok=false with the error code and message on a 429 rate-limit response', async () => {
    globalThis.fetch = (async () =>
      makeJsonResponse(
        makeErrorEnvelope('rate_limited', 'Too many reports. Please try again later.'),
        429
      )) as unknown as typeof fetch;

    const result = await submitShareReport(VALID_TOKEN, 'spam', null);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected err');
    expect(result.code).toBe('rate_limited');
    expect(result.message).toBe('Too many reports. Please try again later.');
  });

  it('returns ok=false with fallback message when the error body is not a valid envelope', async () => {
    globalThis.fetch = (async () =>
      new Response('not json', { status: 500 })) as unknown as typeof fetch;

    const result = await submitShareReport(VALID_TOKEN, 'other', null);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected err');
    expect(result.code).toBe('internal_error');
  });

  it('returns ok=false when a network error occurs before a response', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network unreachable');
    }) as unknown as typeof fetch;

    // submitShareReport does not catch network errors internally; the caller is
    // expected to handle thrown errors (e.g., AbortError from abort signals).
    await expect(submitShareReport(VALID_TOKEN, 'spam', null)).rejects.toThrow(
      'network unreachable'
    );
  });
});
