import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
// Reuse the CLI's exact production asset pipeline for this repository fixture.
import { fileURLToPath } from 'node:url';

import { build } from 'rolldown';

import { bundleUi } from '../../../packages/cli/src/ui/bundle.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const outDir = resolve(root, '.soundor/svg-fixture');
const bundle = await bundleUi({
  root,
  entry: resolve(root, 'src/fixtures/svg.tsx'),
  outDir,
  mode: 'production',
});
if (!bundle) throw new Error('Missing SVG test bundle');
await build({
  input: resolve(outDir, 'bundle.mjs'),
  external: [/^soundor:/],
  output: {
    file: resolve(outDir, 'browser.js'),
    format: 'iife',
    globals: (id) => `globalThis.__soundorModules[${JSON.stringify(id)}]`,
  },
});
await writeFile(
  resolve(outDir, 'browser.js'),
  '\nglobalThis.soundorPlayground={start(){}};\n',
  { flag: 'a' },
);
console.log(outDir);
