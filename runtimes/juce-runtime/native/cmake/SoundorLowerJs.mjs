// Turns an ES module into the form the native runtime runs: a CommonJS module
// function with the syntax Hermes lacks lowered (@soundor/core's
// toNativeModule()). The build runs it on the runtime's own modules (src/,
// soundor_embed_module()) before compiling them to bytecode, and the tests on
// Three.js. Each statement stays on its line, so that stack traces point at
// the module as written.
//
//   node SoundorLowerJs.mjs <input.js> <output.js> [<name>]
//
// <name> is the file name Babel reports problems under (default: <input>'s).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';

// In Soundor's repository, @soundor/core's source, so that nothing has to be
// built first; in an installed @soundor/juce-runtime, the @soundor/core
// installed with it.
const repository = new URL(
  '../../../../packages/core/src/native-module.ts',
  import.meta.url,
);
const { toNativeModule } = existsSync(repository)
  ? await import(repository.href)
  : await import('@soundor/core');

const [input, output, name] = process.argv.slice(2);
if (input === undefined || output === undefined) {
  console.error(
    'usage: node SoundorLowerJs.mjs <input.js> <output.js> [<name>]',
  );
  process.exit(2);
}
const { code } = await toNativeModule(readFileSync(input, 'utf8'), {
  filename: name ?? basename(input),
  retainLines: true,
});
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${code}\n`);
