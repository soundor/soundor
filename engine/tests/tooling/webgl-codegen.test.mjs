import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const webgl = join(root, 'src/gpu/webgl');

describe('WebGL codegen', () => {
  it('has generated files matching the IDL (pnpm gen:webgl regenerates them)', () => {
    execFileSync(
      process.execPath,
      [join(root, 'tools/webgl-codegen.mjs'), '--check'],
      { stdio: 'pipe' },
    );
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
    assert.ok(jsNames.length > 50);
    assert.deepEqual(jsNames, cppNames);
  });
});
