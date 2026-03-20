import { readFileSync } from 'node:fs';

type PackageManifest = {
  dependencies?: Record<string, string>;
};

function readBullmqVersion(path: string): string {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as PackageManifest;
  const version = manifest.dependencies?.bullmq;

  if (!version) {
    throw new Error(`BullMQ must be declared in ${path}`);
  }

  return version;
}

const apiVersion = readBullmqVersion('apps/api/package.json');
const workerVersion = readBullmqVersion('apps/worker/package.json');

if (apiVersion !== workerVersion) {
  throw new Error(`BullMQ version mismatch: api=${apiVersion} worker=${workerVersion}`);
}

console.log(`BullMQ versions aligned: ${apiVersion}`);
