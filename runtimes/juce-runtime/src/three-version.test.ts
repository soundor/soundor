import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('three', () => {
  it('is the same release in the catalog (examples) and the native tests', () => {
    const catalog = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
    const cmake = readFileSync(
      join(
        root,
        'runtimes/juce-runtime/native/cmake/SoundorDependencies.cmake',
      ),
      'utf8',
    );
    const inCatalog = /^\s+three: (\S+)$/m.exec(catalog)?.[1];
    const inCmake = /set\(SOUNDOR_THREE_VERSION "([^"]+)"\)/.exec(cmake)?.[1];
    expect(inCatalog).toBeDefined();
    expect(inCatalog).toBe(inCmake);
  });
});
