import { describe, expect, it } from 'vitest';

import { createProjectPaths, rootFromConfigPath } from './paths';

describe('createProjectPaths', () => {
  it('derives the .soundor/<kind>/<id> layout under the root', () => {
    const paths = createProjectPaths({
      root: '/proj',
      config: '/proj/soundor.config.ts',
      runtimeId: 'juce',
    });
    expect(paths).toEqual({
      root: '/proj',
      config: '/proj/soundor.config.ts',
      dist: '/proj/.soundor/dist/juce',
      gen: '/proj/.soundor/generated/runtimes/juce',
      cache: '/proj/.soundor/cache/juce',
    });
  });

  it('resolves a relative config path against the root', () => {
    const paths = createProjectPaths({
      root: '/proj',
      config: 'soundor.config.ts',
      runtimeId: 'juce',
    });
    expect(paths.config).toBe('/proj/soundor.config.ts');
  });
});

describe('rootFromConfigPath', () => {
  it('returns the directory holding the config', () => {
    expect(rootFromConfigPath('/proj/soundor.config.ts')).toBe('/proj');
  });
});
