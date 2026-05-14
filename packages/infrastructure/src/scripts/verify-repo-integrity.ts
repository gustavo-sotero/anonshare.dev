import { existsSync, readFileSync } from 'node:fs';

const REQUIRED_FILES = [
  'bun.lock',
  '.github/workflows/ci.yml',
  '.github/workflows/release-tag.yml'
] as const;
const CI_LOCKFILE_PATTERNS = ['bun install --frozen-lockfile', 'bun ci'] as const;
const RELEASE_WORKFLOW_PATTERNS = [
  'workflow_run:',
  'release-promotion-main',
  "workflow_run.conclusion == 'success'",
  "workflow_run.event == 'push'",
  "workflow_run.head_branch == 'main'",
  'contents: write',
  'git merge-base --is-ancestor "$release_sha" "$VALIDATED_SHA"',
  'git cat-file -t "refs/tags/$release_tag"',
  'git tag -a "$release_tag" "$VALIDATED_SHA"',
  'refs/heads/release'
] as const;

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

function assertReleaseWorkflowContract(): void {
  const workflowPath = '.github/workflows/release-tag.yml';
  const workflow = readFileSync(workflowPath, 'utf8');

  for (const pattern of RELEASE_WORKFLOW_PATTERNS) {
    if (workflow.includes(pattern)) {
      continue;
    }

    throw new Error(`Release promotion workflow is missing required contract fragment: ${pattern}`);
  }
}

for (const path of REQUIRED_FILES) {
  assertFileExists(path);
}

assertCiUsesFrozenInstall();
assertReleaseWorkflowContract();

console.log(
  'Repository integrity checks passed: bun.lock present, CI install is frozen, and the release promotion workflow contract is intact.'
);
