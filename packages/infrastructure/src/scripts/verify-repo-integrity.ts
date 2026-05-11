import { existsSync, readFileSync } from 'node:fs';

const REQUIRED_FILES = ['bun.lock', '.github/workflows/ci.yml'] as const;
const CI_LOCKFILE_PATTERNS = ['bun install --frozen-lockfile', 'bun ci'] as const;

function assertFileExists(path: string): void {
  if (existsSync(path)) {
    return;
  }

  throw new Error(`Required repository file is missing: ${path}`);
}

function assertCiUsesFrozenInstall(): void {
  const workflowPath = '.github/workflows/ci.yml';
  const workflow = readFileSync(workflowPath, 'utf8');
  const hasSupportedInstall = CI_LOCKFILE_PATTERNS.some((pattern) => workflow.includes(pattern));

  if (hasSupportedInstall) {
    return;
  }

  throw new Error(
    `CI workflow must install dependencies with one of: ${CI_LOCKFILE_PATTERNS.join(', ')}`
  );
}

for (const path of REQUIRED_FILES) {
  assertFileExists(path);
}

assertCiUsesFrozenInstall();

console.log('Repository integrity checks passed: bun.lock present and CI install is frozen.');
