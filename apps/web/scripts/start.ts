import { stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateWebEnv } from '@anonshare/infrastructure/config';
import { logger } from '@anonshare/infrastructure/logger';
import { isApiProxyRequest, proxyApiRequest } from '../src/server/api-proxy';
import { isPathInsideDirectory } from '../src/server/path-utils';
import { readStaticAssetAliasMap, resolveStaticAssetFallback } from '../src/server/static-assets';

validateWebEnv();

// Resolve paths relative to this script's location.
// Works both when run from source (scripts/) and when compiled to dist/.
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const clientDir = resolve(appDir, 'dist/client');
const serverEntry = resolve(appDir, 'dist/server/server.js');
const staticAssetAliases = readStaticAssetAliasMap(clientDir);

async function tryServeStaticFile(filePath: string, cacheControl: string, headers?: HeadersInit) {
  try {
    const fileStat = await stat(filePath);

    if (!fileStat.isFile()) {
      return null;
    }

    return new Response(Bun.file(filePath), {
      headers: {
        ...headers,
        'cache-control': cacheControl
      }
    });
  } catch {
    return null;
  }
}

// Import the TanStack Start SSR handler. Dynamic import keeps the server.js
// out of the bun-build bundle so it is loaded from disk at runtime.
const { default: serverHandler } = (await import(serverEntry)) as {
  default: { fetch: (req: Request) => Promise<Response> };
};

const port = Number(process.env.PORT ?? 3000);
const apiBase = (process.env.APP_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();

    if (isApiProxyRequest(url)) {
      return proxyApiRequest(req, apiBase, requestId);
    }

    // Resolve the requested path inside clientDir to prevent traversal.
    const resolved = resolve(clientDir, `.${url.pathname}`);

    // Only serve paths that are strictly inside clientDir.
    if (isPathInsideDirectory(clientDir, resolved)) {
      const exactFileResponse = await tryServeStaticFile(
        resolved,
        'public, max-age=31536000, immutable'
      );

      if (exactFileResponse) {
        return exactFileResponse;
      }
    }

    const fallbackAsset = resolveStaticAssetFallback(url.pathname, staticAssetAliases);

    if (fallbackAsset) {
      const fallbackPath = resolve(clientDir, 'assets', fallbackAsset);
      const fallbackResponse = await tryServeStaticFile(fallbackPath, 'no-store', {
        'x-asset-fallback': '1',
        'x-request-id': requestId
      });

      if (fallbackResponse) {
        logger.warn('Served current asset for stale hashed request', {
          event: 'static_asset_fallback_served',
          service: 'web',
          requestId,
          actor: 'anonymous',
          entity: { type: 'static_asset', id: url.pathname },
          outcome: 'success',
          fallbackAsset: `/assets/${fallbackAsset}`
        });

        return fallbackResponse;
      }
    }

    const response = await serverHandler.fetch(req);

    // Prevent browsers from caching HTML documents so asset hashes from a
    // previous deploy never break a fresh deployment.
    const ct = response.headers.get('content-type') ?? '';
    if (ct.includes('text/html')) {
      const headers = new Headers(response.headers);
      headers.set('cache-control', 'no-store');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }

    return response;
  }
});

console.log(`[web:start] Listening on port ${server.port}`);

process.once('SIGTERM', () => server.stop(true));
process.once('SIGINT', () => server.stop(true));
