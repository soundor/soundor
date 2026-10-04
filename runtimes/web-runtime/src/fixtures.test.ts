import { readFile, writeFile } from 'node:fs/promises';

import { generateSoundorFiles, type SoundorConfig } from '@soundor/runtime-sdk';
import { describe, expect, it } from 'vitest';

import { fixtureConfig } from './client/testing/fixture';
import { generateWebSources } from './codegen';

const config = fixtureConfig as unknown as SoundorConfig;
const dir = new URL('./client/testing/', import.meta.url);

/** The fixture files and what generates them. */
function expected(): Record<string, string> {
  const core = Object.fromEntries(
    generateSoundorFiles(config).map((file) => [file.path, file.contents]),
  );
  const web = Object.fromEntries(
    generateWebSources(config).map((file) => [file.path, file.contents]),
  );
  return {
    'manifest.json': web['manifest.json']!,
    'native.ts': web['native.ts']!,
    // Not native.d.ts: next to native.ts, TypeScript would ignore it.
    'soundor-native.d.ts': core['native.d.ts']!,
    'parameters.d.ts': core['parameters.d.ts']!,
    'platform.d.ts': core['platform.d.ts']!,
  };
}

describe('client test fixtures', () => {
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
