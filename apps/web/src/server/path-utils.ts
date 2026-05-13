import { isAbsolute, relative } from 'node:path';

export function isPathInsideDirectory(parentDir: string, childPath: string): boolean {
  const rel = relative(parentDir, childPath);

  if (!rel) {
    return true;
  }

  return !rel.startsWith('..') && !isAbsolute(rel);
}
