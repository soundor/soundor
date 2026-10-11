// Turns the runtime's own JavaScript modules (native/src/**/*.js, written as
// ES modules) into the form the native runtime runs: CommonJS module
// functions with the syntax Hermes lacks lowered (@soundor/core's
// toNativeModule()). The build compiles these to bytecode with hermesc; a
// cross build embeds them as source.
//
//   node scripts/native-modules.mjs [--check]
//
// Output: native/src/generated/<path of the module>, each statement on its
// line in the module, so that stack traces point at the module as written
// (the generated-file notice is the last line, not the first).
// --check fails when they are not up to date.

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toNativeModule } from '../../../packages/core/src/native-module.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'native/src');
const output = join(source, 'generated');
const check = process.argv.includes('--check');

/** Every .js module under native/src, but the generated ones. */
function modules(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (path !== output) found.push(...modules(path));
    } else if (entry.name.endsWith('.js')) {
      found.push(path);
    }
  }
  return found.sort();
}

function generatedFiles(directory) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...generatedFiles(path));
    else found.push(path);
  }
  return found;
}

const expected = new Map();
for (const file of modules(source)) {
  const name = relative(source, file).split(sep).join('/');
  const { code } = await toNativeModule(readFileSync(file, 'utf8'), {
    filename: name,
    retainLines: true,
  });
  expected.set(
    join(output, name),
    `${code}\n// Generated from native/src/${name} by scripts/native-modules.mjs. Do not edit.\n`,
  );
}

const stale = [];
for (const [path, contents] of expected) {
  let current;
  try {
    current = readFileSync(path, 'utf8');
  } catch {
    current = undefined;
  }
  if (current === contents) continue;
  stale.push(relative(root, path));
  if (!check) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
}
for (const path of generatedFiles(output)) {
  if (expected.has(path)) continue;
  stale.push(relative(root, path));
  if (!check) rmSync(path);
}

if (check && stale.length > 0) {
  console.error(
    `Out of date (run pnpm --filter @soundor/juce-runtime gen:native-modules):\n  ${stale.join('\n  ')}`,
  );
  process.exit(1);
}
