/**
 * Where the Soundor engine's WebAssembly (`soundor-core.wasm`, the engine's
 * C++ core with its Yoga, which soundor:ui lays out with) comes from. One
 * place decides, so that a resolver of published engine modules can take
 * its place without the browser code knowing.
 *
 * For now it is the module the engine package built locally
 * (`pnpm --filter @soundor/engine build:wasm`), or the file
 * `SOUNDOR_ENGINE_WASM` names.
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** The environment variable naming a module to use instead. */
export const ENGINE_WASM_ENV = 'SOUNDOR_ENGINE_WASM';

/** Where the engine package writes its module, from its directory. */
const LOCAL_BUILD = 'build/wasm/web/soundor-core.wasm';

const require = createRequire(import.meta.url);

/** The engine package's directory, as this package resolves it. */
function enginePackageDir(): string | undefined {
  try {
    return dirname(require.resolve('@soundor/engine/package.json'));
  } catch {
    return undefined;
  }
}

/**
 * The path of the engine's module. Throws an error saying how to build it
 * when there is none.
 */
export function engineWasmPath(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const given = env[ENGINE_WASM_ENV];
  if (given !== undefined && given !== '') {
    if (!existsSync(given))
      throw new Error(
        `${ENGINE_WASM_ENV} names ${given}, which does not exist: it should be the Soundor engine's soundor-core.wasm`,
      );
    return given;
  }
  const dir = enginePackageDir();
  const local = dir === undefined ? undefined : join(dir, LOCAL_BUILD);
  if (local !== undefined && existsSync(local)) return local;
  throw new Error(
    [
      "The Soundor engine's WebAssembly (soundor-core.wasm) was not found" +
        (local === undefined ? '.' : ` at ${local}.`),
      'The web runtime lays its UI out with it. Build it with `pnpm --filter @soundor/engine build:wasm` (needs Emscripten),',
      `or set ${ENGINE_WASM_ENV} to a soundor-core.wasm.`,
    ].join('\n'),
  );
}
