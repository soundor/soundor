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

// Workspace builds use the engine's source immediately; installed packages
// use its ordinary JS build. Neither path compiles native code in pnpm build.
const workspace = new URL('../../../pnpm-workspace.yaml', import.meta.url);
const module = existsSync(workspace)
  ? new URL('../scripts/native-module.ts', import.meta.url)
  : new URL('../dist/native-module.mjs', import.meta.url);
const { toNativeModule } = await import(module.href);

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
