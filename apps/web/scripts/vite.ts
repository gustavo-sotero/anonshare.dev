import { validateWebEnv } from '@anonshare/infrastructure/config';

const command = process.argv[2] ?? 'dev';

if (command !== 'build') {
  validateWebEnv();
}

process.argv = [process.argv[0] ?? 'bun', 'vite', ...process.argv.slice(2)];

await import(new URL('../node_modules/vite/dist/node/cli.js', import.meta.url).href);
