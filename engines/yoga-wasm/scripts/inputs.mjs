// What decides the module's bytes. The revision and the patches are the
// engine's: both runtimes must lay out with one Yoga, so they are read from its
// recipes, never repeated here. The package's version is not an input: a new
// version with the same inputs reuses the published module.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const engineCmake = join(
  dirname(
    createRequire(import.meta.url).resolve('@soundor/engine/package.json'),
  ),
  'cmake',
);

/** The Yoga that `@soundor/engine` pins. */
export function yogaPin(
  dependencies = readFileSync(
    join(engineCmake, 'SoundorDependencies.cmake'),
    'utf8',
  ),
) {
  const read = (key) => {
    const match = new RegExp(`set\\(SOUNDOR_YOGA_${key} "([^"]+)"\\)`).exec(
      dependencies,
    );
    if (match === null)
      throw new Error(`SoundorDependencies.cmake has no SOUNDOR_YOGA_${key}`);
    return match[1];
  };
  return {
    version: read('VERSION'),
    revision: read('REVISION'),
    sha256: read('SHA256'),
  };
}

const text = (file) => readFileSync(file, 'utf8').replaceAll('\r\n', '\n');

export function yogaInputs() {
  const pin = yogaPin();
  const hash = createHash('sha256').update('soundor-yoga-wasm-inputs-v1\0');
  hash.update(`${pin.version}\0${pin.revision}\0${pin.sha256}\0`);
  for (const [name, file] of [
    ['patch', join(engineCmake, 'SoundorYogaPatch.cmake')],
    ['shim', join(packageRoot, 'native/shim.cpp')],
    ['exports', join(packageRoot, 'src/exports.ts')],
    // Its flags and the wasi-sdk it pins.
    ['compile', join(packageRoot, 'scripts/compile.mjs')],
  ])
    hash.update(`${name}\0${text(file)}\0`);
  return { fingerprint: hash.digest('hex'), pin };
}
