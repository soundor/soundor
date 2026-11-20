import { describe, expect, it } from 'vitest';

import { createProjectPaths, rootFromConfigPath } from './paths';

describe('createProjectPaths', () => {
  it('derives the .soundor/<kind>/<id> layout under the root', () => {
    const paths = createProjectPaths({
      root: '/proj',
      config: '/proj/soundor.config.ts',
      runtimeId: 'vst3',
    });
    expect(paths).toEqual({
      root: '/proj',
      config: '/proj/soundor.config.ts',
      dist: '/proj/.soundor/dist/vst3',
      gen: '/proj/.soundor/generated/runtimes/vst3',
      cache: '/proj/.soundor/cache/vst3',
      state: '/proj/.soundor/state/vst3',
    });
  });

  it('resolves a relative config path against the root', () => {
    const paths = createProjectPaths({
      root: '/proj',
      config: 'soundor.config.ts',
      runtimeId: 'vst3',
    });
    expect(paths.config).toBe('/proj/soundor.config.ts');
  });
});

describe('rootFromConfigPath', () => {
  it('returns the directory holding the config', () => {
    expect(rootFromConfigPath('/proj/soundor.config.ts')).toBe('/proj');
  });
});
