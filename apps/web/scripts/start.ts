import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateWebEnv } from '@anonshare/infrastructure/config';

validateWebEnv();

const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverEntry = './dist/server/server.js';
const child = Bun.spawn([process.execPath, serverEntry], {
  cwd,
  env: process.env,
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit'
});

const exitCode = await child.exited;

if (exitCode !== 0) {
  throw new Error(
    exitCode === 1
      ? '[web:start] Failed to start the built web server. Run `bun run build` in apps/web and review the server output above.'
      : `[web:start] Built web server exited with code ${exitCode}.`
  );
}
