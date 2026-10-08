import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const webgl = join(root, 'native/src/gpu/webgl');

describe('WebGL codegen', () => {
  it('has generated files matching the IDL (pnpm gen:webgl regenerates them)', () => {
    expect(() =>
      execFileSync(
        process.execPath,
        [join(root, 'scripts/webgl-codegen.mjs'), '--check'],
        { stdio: 'pipe' },
      ),
    ).not.toThrow();
  });

  it('numbers the hand-written operations the same in webgl.js and WebGLModule.cpp', () => {
    const js = readFileSync(join(webgl, 'webgl.js'), 'utf8');
    const cpp = readFileSync(join(webgl, 'WebGLModule.cpp'), 'utf8');
    const hand = /const HAND = \[([\s\S]*?)\];/.exec(js)?.[1] ?? '';
    const jsNames = [...hand.matchAll(/'(\w+)'/g)].map(([, name = '']) =>
      name.toLowerCase(),
    );
    const handOp = /enum class HandOp[^{]*\{([\s\S]*?)\};/.exec(cpp)?.[1] ?? '';
    const cppNames = [...handOp.matchAll(/(\w+),/g)].map(([, name = '']) =>
      name.toLowerCase(),
    );
    expect(jsNames.length).toBeGreaterThan(50);
    expect(jsNames).toEqual(cppNames);
  });
});
