import { readFile, writeFile } from 'node:fs/promises';

import { generateSoundorFiles, resolveConfig } from '@soundor/runtime-sdk';
import { describe, expect, it } from 'vitest';

import { version as runtimeVersion } from '../package.json' with { type: 'json' };
import { fixtureConfig } from './client/testing/fixture';
import { generateWebSources } from './codegen';

const config = resolveConfig(fixtureConfig);
const dir = new URL('./client/testing/', import.meta.url);

/** The fixture files and what generates them. */
function expected(): Record<string, string> {
  const core = Object.fromEntries(
    generateSoundorFiles(config).map((file) => [file.path, file.contents]),
  );
  const web = Object.fromEntries(
    generateWebSources(config).map((file) => [file.path, file.contents]),
  );
  // A checked-in fixture uses a synthetic version so releases do not stale it.
  const manifest = JSON.parse(web['manifest.json']!);
  manifest.runtimeVersion = '0.0.0';
  return {
    'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'native.ts': web['native.ts']!,
    'parameters.js': web['parameters.js']!,
    // Not native.d.ts: next to native.ts, TypeScript would ignore it.
    'soundor-native.d.ts': core['native.d.ts']!,
    'parameters.d.ts': core['parameters.d.ts']!,
  };
}

describe('client test fixtures', () => {
  it('generates the actual runtime package version', () => {
    const manifest = generateWebSources(config).find(
      (file) => file.path === 'manifest.json',
    )!;
    expect(JSON.parse(manifest.contents).runtimeVersion).toBe(runtimeVersion);
  });
  it('match what Soundor generates for the fixture plugin', async () => {
    for (const [name, contents] of Object.entries(expected())) {
      const url = new URL(name, dir);
      if (process.env['UPDATE_FIXTURES'] === '1') {
        await writeFile(url, contents);
      }
      expect({ name, contents: await readFile(url, 'utf8') }).toEqual({
        name,
        contents,
      });
    }
  });
});
