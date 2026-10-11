// Turns ES modules into the native runtime's module form (@soundor/core's
// toNativeModule()), file by file: for files the native tests load as plugin
// code (Three.js's build). Plugins get theirs from the CLI's bundler.
//
//   node scripts/native-module.mjs <output directory> <module.js>...

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { toNativeModule } from '../../../packages/core/src/native-module.ts';

const [output, ...inputs] = process.argv.slice(2);
if (output === undefined || inputs.length === 0) {
  console.error(
    'usage: node scripts/native-module.mjs <output directory> <module.js>...',
  );
  process.exit(2);
}
mkdirSync(output, { recursive: true });
for (const input of inputs) {
  const { code } = await toNativeModule(readFileSync(input, 'utf8'), {
    filename: basename(input),
    retainLines: true,
  });
  writeFileSync(join(output, basename(input)), `${code}\n`);
}
