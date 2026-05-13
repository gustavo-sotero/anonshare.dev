import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { isPathInsideDirectory } from './path-utils';

describe('isPathInsideDirectory', () => {
  test('accepts files inside the target directory', () => {
    const parentDir = resolve('tmp', 'web-client');
    const childPath = resolve(parentDir, 'assets', 'app.js');

    expect(isPathInsideDirectory(parentDir, childPath)).toBe(true);
  });

  test('rejects files outside the target directory', () => {
    const parentDir = resolve('tmp', 'web-client');
    const childPath = resolve(parentDir, '..', 'outside', 'app.js');

    expect(isPathInsideDirectory(parentDir, childPath)).toBe(false);
  });

  test('rejects sibling directories that only share a string prefix', () => {
    const parentDir = resolve('tmp', 'web-client');
    const siblingPath = resolve(`${parentDir}-old`, 'assets', 'app.js');

    expect(isPathInsideDirectory(parentDir, siblingPath)).toBe(false);
  });
});
