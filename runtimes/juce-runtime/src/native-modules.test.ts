import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('the runtime modules in the native form', () => {
  it('are generated from native/src (pnpm gen:native-modules regenerates them)', () => {
    expect(() =>
      execFileSync(
        process.execPath,
        [join(root, 'scripts/native-modules.mjs'), '--check'],
        { stdio: 'pipe' },
      ),
    ).not.toThrow();
  });

  it('keep each statement on its line, so stack traces point at the source', () => {
    const source = readFileSync(
      join(root, 'native/src/modules/ui/ui.js'),
      'utf8',
    );
    const generated = readFileSync(
      join(root, 'native/src/generated/modules/ui/ui.js'),
      'utf8',
    );
    const line = source
      .split('\n')
      .findIndex((text) => text.includes('class UiNode'));
    expect(line).toBeGreaterThan(0);
    expect(generated.split('\n')[line]).toMatch(/UiNode/);
  });
});
