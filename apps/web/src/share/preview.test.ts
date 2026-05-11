import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { readTextPreview } from './preview';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeTextResponse(text: string): Response {
  return new Response(text, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' }
  });
}

function makeStreamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' }
  });
}

// ─── readTextPreview ──────────────────────────────────────────────────────────

// Bun's mock() return type lacks the `preconnect` property required by
// `typeof fetch`. This helper casts to avoid the TS2741 assignment errors.
function stubFetch(fn: (...args: Parameters<typeof fetch>) => Promise<Response | never>) {
  globalThis.fetch = fn as unknown as typeof globalThis.fetch;
}

describe('readTextPreview', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns full text when content is within the byte limit', async () => {
    stubFetch(mock(() => Promise.resolve(makeTextResponse('hello world'))));

    const result = await readTextPreview('https://example.com/file.txt', 1024);

    expect(result.text).toBe('hello world');
    expect(result.truncated).toBe(false);
  });

  it('truncates when content exceeds the byte limit', async () => {
    stubFetch(mock(() => Promise.resolve(makeStreamResponse(['a'.repeat(200)]))));

    const result = await readTextPreview('https://example.com/file.txt', 100);

    expect(result.text).toHaveLength(100);
    expect(result.truncated).toBe(true);
  });

  it('returns truncated=false for exact-length content', async () => {
    const content = 'x'.repeat(50);
    stubFetch(mock(() => Promise.resolve(makeStreamResponse([content]))));

    const result = await readTextPreview('https://example.com/file.txt', 50);

    expect(result.text).toHaveLength(50);
    expect(result.truncated).toBe(false);
  });

  it('handles body-less response by falling back to response.text()', async () => {
    // Simulate a body-less response via a plain cast — Object.create loses the
    // native Response identity in Bun and causes getter errors.
    const noBodyResponse = {
      ok: true,
      body: null,
      text: () => Promise.resolve('plain text')
    } as unknown as Response;
    stubFetch(mock(() => Promise.resolve(noBodyResponse)));

    const result = await readTextPreview('https://example.com/file.txt', 1024);

    expect(result.text).toBe('plain text');
  });

  it('throws when the response is not ok', async () => {
    stubFetch(mock(() => Promise.resolve(new Response('Not found', { status: 404 }))));

    await expect(readTextPreview('https://example.com/file.txt', 1024)).rejects.toThrow(
      'Preview request failed'
    );
  });

  it('rethrows AbortError when the signal is externally cancelled', async () => {
    const controller = new AbortController();
    stubFetch(
      mock(() => {
        controller.abort();
        const err = new DOMException('Aborted', 'AbortError');
        return Promise.reject(err);
      })
    );

    await expect(
      readTextPreview('https://example.com/file.txt', 1024, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
