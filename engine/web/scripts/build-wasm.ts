// Builds the WebAssembly core (`pnpm build:wasm`): engine({ target: 'web',
// mode: 'source' }), the engine's `wasm` CMake preset with Emscripten from the
// environment (EMSDK, as emsdk_env sets it), staged in build/wasm/stage/ as a
// release archive holds it. Never part of `pnpm build`; ordinary web builds
// use the published module instead.
import { statSync } from 'node:fs';

import { engine } from '../../node/src/index.ts';

try {
  const { files } = await engine({ target: 'web', mode: 'source' });
  console.log(`${files.wasm}: ${statSync(files.wasm).size} bytes`);
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
