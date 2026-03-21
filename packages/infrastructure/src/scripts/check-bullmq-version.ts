import { readFileSync } from 'node:fs';

type PackageManifest = {
  dependencies?: Record<string, string>;
};

type BullmqConsumer = {
  name: string;
  path: string;
};

function readBullmqVersion(path: string): string {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as PackageManifest;
  const version = manifest.dependencies?.bullmq;

  if (!version) {
    throw new Error(`BullMQ must be declared in ${path}`);
  }

  return version;
}

const consumers: BullmqConsumer[] = [
  { name: 'api', path: 'apps/api/package.json' },
  { name: 'worker', path: 'apps/worker/package.json' },
  { name: 'infrastructure', path: 'packages/infrastructure/package.json' }
];

const versions = consumers.map((consumer) => ({
  name: consumer.name,
  version: readBullmqVersion(consumer.path)
}));

const expectedVersion = versions[0]?.version;

if (!expectedVersion) {
  throw new Error('No BullMQ consumers configured for parity validation');
}

const mismatches = versions.filter((entry) => entry.version !== expectedVersion);

if (mismatches.length > 0) {
  const details = versions.map((entry) => `${entry.name}=${entry.version}`).join(' ');
  throw new Error(`BullMQ version mismatch: ${details}`);
}

console.log(
  `BullMQ versions aligned: ${versions.map((entry) => `${entry.name}=${entry.version}`).join(' ')}`
);
