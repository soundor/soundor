import assert from 'node:assert/strict';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

import { engineInputs } from '../../scripts/engine-inputs.mjs';

const engine = fileURLToPath(new URL('../..', import.meta.url));
const packaged = mkdtempSync(join(tmpdir(), 'soundor-bundled-lowering-'));
after(() => rmSync(packaged, { recursive: true, force: true }));
for (const path of [
  'src',
  'include',
  'cmake',
  'scripts',
  'CMakeLists.txt',
  'package.json',
  'dist',
])
  cpSync(join(engine, path), join(packaged, path), { recursive: true });

test('the built engine has the same identity after packaging without node_modules', () => {
  assert.equal(
    engineInputs(packaged).fingerprint,
    engineInputs(engine).fingerprint,
  );
});

test('the published lowering bundle runs without installed runtime dependencies', async () => {
  const { toNativeModule } = await import(
    pathToFileURL(join(packaged, 'dist/native-module.mjs')).href
  );
  const { code } = await toNativeModule(`
    export class Counter {
      #value = 1;
      static { this.start = 1; }
      async increment() { return ++this.#value; }
    }
    export const counter = new Counter();
    export const result = await counter.increment();
  `);
  const exports = {};
  await runInNewContext(code)(
    exports,
    () => {
      throw new Error('unexpected import');
    },
    {},
  );
  assert.equal(exports.result, 2);
  assert.equal(exports.Counter.start, 1);
});

test('bundled and workspace lowering produce identical embedded runtime modules', async () => {
  const { toNativeModule: source } =
    await import('../../scripts/native-module.ts');
  const { toNativeModule: bundled } = await import(
    pathToFileURL(join(packaged, 'dist/native-module.mjs')).href
  );
  for (const path of readdirSync(join(engine, 'src'), {
    recursive: true,
  }).filter((path) => path.endsWith('.js'))) {
    const code = readFileSync(join(engine, 'src', path), 'utf8');
    const options = { filename: path.replaceAll('\\', '/'), retainLines: true };
    assert.deepEqual(
      await bundled(code, options),
      await source(code, options),
      path,
    );
  }
});
