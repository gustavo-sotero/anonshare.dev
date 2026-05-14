import { afterEach, describe, expect, test } from 'bun:test';
import { buildApiProxyUrl, isApiProxyRequest, proxyApiRequest } from './api-proxy';

type CapturedRequest = {
  url: string;
  method: string;
  headers: Headers;
  bodyText: string;
};

function requireCapturedRequest(capturedRequest: CapturedRequest | null): CapturedRequest {
  if (!capturedRequest) {
    throw new Error('Expected proxy request to reach the upstream fetch mock');
  }

  return capturedRequest;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('api proxy helpers', () => {
  test('detects only /api-prefixed requests', () => {
    expect(isApiProxyRequest(new URL('http://localhost:3000/api'))).toBe(true);
    expect(isApiProxyRequest(new URL('http://localhost:3000/api/share/token'))).toBe(true);
    expect(isApiProxyRequest(new URL('http://localhost:3000/about'))).toBe(false);
    expect(isApiProxyRequest(new URL('http://localhost:3000/apiary'))).toBe(false);
  });

  test('rewrites /api paths against the configured API origin', () => {
    expect(
      buildApiProxyUrl('http://localhost:3000/api/share/token?preview=1', 'http://localhost:3001')
    ).toBe('http://localhost:3001/share/token?preview=1');

    expect(buildApiProxyUrl('http://localhost:3000/api', 'http://localhost:3001/')).toBe(
      'http://localhost:3001/'
    );

    expect(
      buildApiProxyUrl(
        'http://localhost:3000/api/share/token?preview=1',
        'http://localhost:3001/internal'
      )
    ).toBe('http://localhost:3001/internal/share/token?preview=1');
  });

  test('forwards method, body, cookies, and tracing headers to the API service', async () => {
    let capturedRequest: CapturedRequest | null = null;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      capturedRequest = {
        url: request.url,
        method: request.method,
        headers: new Headers(request.headers),
        bodyText: await request.text()
      };
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }) as unknown as typeof fetch;

    const response = await proxyApiRequest(
      new Request('http://localhost:3000/api/report/token-123?source=e2e', {
        method: 'POST',
        headers: {
          cookie: 'admin_session=abc123',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ reason: 'spam' })
      }),
      'http://localhost:3001',
      'req-123'
    );

    expect(capturedRequest).not.toBeNull();
    const forwardedRequest = requireCapturedRequest(capturedRequest);

    expect(forwardedRequest.url).toBe('http://localhost:3001/report/token-123?source=e2e');
    expect(forwardedRequest.method).toBe('POST');
    expect(forwardedRequest.headers.get('cookie')).toBe('admin_session=abc123');
    expect(forwardedRequest.headers.get('x-request-id')).toBe('req-123');
    expect(forwardedRequest.headers.get('x-forwarded-host')).toBe('localhost:3000');
    expect(forwardedRequest.headers.get('x-forwarded-proto')).toBe('http');
    expect(forwardedRequest.bodyText).toBe(JSON.stringify({ reason: 'spam' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('req-123');
  });
});
