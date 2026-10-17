import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { siteValues } from './values.ts';

const manifest = (path: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../${path}/package.json`, import.meta.url),
      'utf-8',
    ),
  ) as { version: string; engines?: Record<string, string> };

describe('siteValues', () => {
  const values = siteValues();

  it("has every published package's version, from the workspace", () => {
    for (const [name, path] of [
      ['soundor', 'packages/cli'],
      ['create-soundor-app', 'packages/create-soundor-app'],
      ['@soundor/react', 'packages/react'],
      ['@soundor/juce-runtime', 'runtimes/juce-runtime'],
      ['@soundor/web-runtime', 'runtimes/web-runtime'],
      ['@soundor/engine', 'runtimes/engine'],
    ]) {
      expect({ [name!]: values.versions[name!] }).toEqual({
        [name!]: manifest(path!).version,
      });
    }
  });

  it("has the CLI's Node versions, not the repository's own", () => {
    expect(values.node).toBe(manifest('packages/cli').engines?.['node']);
  });
});
