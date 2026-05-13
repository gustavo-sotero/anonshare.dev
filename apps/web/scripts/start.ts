import { stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateWebEnv } from '@anonshare/infrastructure/config';

validateWebEnv();

// Resolve paths relative to this script's location.
// Works both when run from source (scripts/) and when compiled to dist/.
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const clientDir = resolve(appDir, 'dist/client');
const serverEntry = resolve(appDir, 'dist/server/server.js');

// Import the TanStack Start SSR handler. Dynamic import keeps the server.js
// out of the bun-build bundle so it is loaded from disk at runtime.
const { default: serverHandler } = (await import(serverEntry)) as {
  default: { fetch: (req: Request) => Response | Promise<Response> };
};

const port = Number(process.env.PORT ?? 3000);

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    // Resolve the requested path inside clientDir to prevent traversal.
    const resolved = resolve(clientDir, `.${url.pathname}`);

    // Only serve paths that are strictly inside clientDir.
    if (resolved.startsWith(`${clientDir}/`)) {
      try {
        const s = await stat(resolved);
        if (s.isFile()) {
          return new Response(Bun.file(resolved), {
            headers: { 'cache-control': 'public, max-age=31536000, immutable' }
          });
        }
      } catch {
        // File not found — fall through to SSR handler below.
      }
    }

    return serverHandler.fetch(req) as Promise<Response>;
  }
});

console.log(`[web:start] Listening on port ${server.port}`);

process.once('SIGTERM', () => server.stop(true));
process.once('SIGINT', () => server.stop(true));
