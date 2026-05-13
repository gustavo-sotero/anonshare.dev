import { describe, expect, test } from 'bun:test';
import { buildStaticAssetAliasMap, resolveStaticAssetFallback } from './static-assets';

describe('buildStaticAssetAliasMap', () => {
  test('maps hashed asset families to the current generated file', () => {
    const aliases = buildStaticAssetAliasMap([
      'app-CNDcXbr4.css',
      'index-BgSLZ3Wx.js',
      'share._token-DBoY9YLG.js'
    ]);

    expect(aliases.get('app.css')).toBe('app-CNDcXbr4.css');
    expect(aliases.get('index.js')).toBe('index-BgSLZ3Wx.js');
    expect(aliases.get('share._token.js')).toBe('share._token-DBoY9YLG.js');
  });

  test('drops ambiguous families instead of guessing', () => {
    const aliases = buildStaticAssetAliasMap(['app-oldhash.css', 'app-newhash.css']);

    expect(aliases.has('app.css')).toBe(false);
  });
});

describe('resolveStaticAssetFallback', () => {
  test('resolves a stale hashed request to the current asset family member', () => {
    const aliases = buildStaticAssetAliasMap(['app-CNDcXbr4.css', 'admin-Bz7Q6ukH.js']);

    expect(resolveStaticAssetFallback('/assets/app-Bmf_VBKf.css', aliases)).toBe(
      'app-CNDcXbr4.css'
    );
    expect(resolveStaticAssetFallback('/assets/admin-oldHash12.js', aliases)).toBe(
      'admin-Bz7Q6ukH.js'
    );
  });

  test('ignores unhashed, nested, and unknown asset requests', () => {
    const aliases = buildStaticAssetAliasMap(['app-CNDcXbr4.css']);

    expect(resolveStaticAssetFallback('/assets/app.css', aliases)).toBeNull();
    expect(resolveStaticAssetFallback('/assets/nested/app-Bmf_VBKf.css', aliases)).toBeNull();
    expect(resolveStaticAssetFallback('/health', aliases)).toBeNull();
    expect(resolveStaticAssetFallback('/assets/unknown-Bmf_VBKf.css', aliases)).toBeNull();
  });
});
