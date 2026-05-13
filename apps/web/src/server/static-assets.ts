import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ASSET_ROUTE_PREFIX = '/assets/';
const HASHED_ASSET_PATTERN = /^(?<base>.+)-[A-Za-z0-9_-]{6,}\.(?<ext>css|js)$/;

function getHashedAssetKey(fileName: string): string | null {
  const match = HASHED_ASSET_PATTERN.exec(fileName);

  if (!match?.groups) {
    return null;
  }

  return `${match.groups.base}.${match.groups.ext}`;
}

function getRequestedAssetFileName(pathname: string): string | null {
  if (!pathname.startsWith(ASSET_ROUTE_PREFIX)) {
    return null;
  }

  const fileName = pathname.slice(ASSET_ROUTE_PREFIX.length);

  if (!fileName || fileName.includes('/')) {
    return null;
  }

  return fileName;
}

export function buildStaticAssetAliasMap(fileNames: readonly string[]): Map<string, string> {
  const aliases = new Map<string, string>();
  const ambiguousKeys = new Set<string>();

  for (const fileName of fileNames) {
    const key = getHashedAssetKey(fileName);

    if (!key || ambiguousKeys.has(key)) {
      continue;
    }

    if (aliases.has(key)) {
      aliases.delete(key);
      ambiguousKeys.add(key);
      continue;
    }

    aliases.set(key, fileName);
  }

  return aliases;
}

export function readStaticAssetAliasMap(clientDir: string): Map<string, string> {
  const assetsDir = resolve(clientDir, 'assets');

  if (!existsSync(assetsDir)) {
    return new Map();
  }

  const fileNames = readdirSync(assetsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

  return buildStaticAssetAliasMap(fileNames);
}

export function resolveStaticAssetFallback(
  pathname: string,
  aliases: ReadonlyMap<string, string>
): string | null {
  const requestedFileName = getRequestedAssetFileName(pathname);

  if (!requestedFileName) {
    return null;
  }

  const key = getHashedAssetKey(requestedFileName);

  if (!key) {
    return null;
  }

  return aliases.get(key) ?? null;
}
