// Builds the WebAssembly core (`pnpm build:wasm`): the engine's `wasm` CMake
// preset, with Emscripten from the environment (EMSDK, as emsdk_env sets it).
// Writes build/wasm/web/soundor-core.wasm; never part of `pnpm build`.
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '../..');
const emsdk = process.env['EMSDK'];
const toolchain =
  emsdk &&
  join(emsdk, 'upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake');
if (!toolchain || !existsSync(toolchain)) {
  console.error(
    'build:wasm needs Emscripten: install the emsdk (https://emscripten.org/docs/getting_started/downloads.html), ' +
      'then `source <emsdk>/emsdk_env.sh` so that EMSDK is set.',
  );
  process.exit(1);
}

// Flags meant for the native linker (the cell's LDFLAGS=-fuse-ld=lld) are not
// Emscripten's.
const env = { ...process.env };
delete env['LDFLAGS'];
const result = spawnSync('cmake', ['--workflow', '--preset', 'wasm'], {
  cwd: root,
  env,
  stdio: 'inherit',
});
if (result.status !== 0) process.exit(result.status ?? 1);

const output = join(root, 'build/wasm/web/soundor-core.wasm');
console.log(`${output}: ${statSync(output).size} bytes`);
