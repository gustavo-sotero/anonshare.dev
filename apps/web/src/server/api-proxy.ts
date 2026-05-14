const API_PROXY_PREFIX = '/api';

export function isApiProxyRequest(url: URL): boolean {
  return url.pathname === API_PROXY_PREFIX || url.pathname.startsWith(`${API_PROXY_PREFIX}/`);
}

export function buildApiProxyUrl(requestUrl: string | URL, apiBase: string): string {
  const sourceUrl = typeof requestUrl === 'string' ? new URL(requestUrl) : requestUrl;
  const targetUrl = new URL(apiBase);
  const proxiedPath = sourceUrl.pathname.replace(/^\/api(?=\/|$)/, '') || '/';
  const basePath = targetUrl.pathname === '/' ? '' : targetUrl.pathname.replace(/\/$/, '');

  targetUrl.pathname = `${basePath}${proxiedPath}`;
  targetUrl.search = sourceUrl.search;

  return targetUrl.toString();
}

export async function proxyApiRequest(
  request: Request,
  apiBase: string,
  requestId: string
): Promise<Response> {
  const sourceUrl = new URL(request.url);
  const targetUrl = buildApiProxyUrl(sourceUrl, apiBase);
  const headers = new Headers(request.headers);

  if (!headers.has('x-request-id')) {
    headers.set('x-request-id', requestId);
  }

  if (!headers.has('x-forwarded-host')) {
    headers.set('x-forwarded-host', sourceUrl.host);
  }

  if (!headers.has('x-forwarded-proto')) {
    headers.set('x-forwarded-proto', sourceUrl.protocol.replace(/:$/, ''));
  }

  headers.delete('host');

  const method = request.method.toUpperCase();
  const upstreamRequestInit: RequestInit = {
    method,
    headers,
    redirect: 'manual',
    signal: request.signal
  };

  if (method !== 'GET' && method !== 'HEAD' && request.body !== null) {
    upstreamRequestInit.body = request.body;
  }

  const upstreamRequest = new Request(targetUrl, upstreamRequestInit);

  const upstreamResponse = await fetch(upstreamRequest);
  const responseHeaders = new Headers(upstreamResponse.headers);

  if (!responseHeaders.has('x-request-id')) {
    responseHeaders.set('x-request-id', requestId);
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders
  });
}
