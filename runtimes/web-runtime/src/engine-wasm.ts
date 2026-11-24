/**
 * Where the Soundor engine's WebAssembly (`soundor-core.wasm`, the engine's
 * C++ core with its Yoga, which soundor:ui lays out with) comes from. One
 * place decides, without the browser code knowing: the page always loads it
 * from the application's own assets.
 *
 * It is `engine({ target: 'web' })` of the installed `@soundor/engine`: the
 * published module of that version, downloaded (and verified) once into the
 * Soundor cache; in the engine's source checkout a local build when its
 * sources differ. `SOUNDOR_ENGINE_WASM` names a module to use instead
 * (checked by the engine: an unreleased build, a CI artifact).
 */

import { engine } from '@soundor/engine';

/** The path of the engine's module, prepared. Throws saying why there is none. */
export async function engineWasmPath(): Promise<string> {
  const artifact = await engine({ target: 'web' });
  return artifact.files.wasm;
}

/**
 * The notices of what the engine's module contains (the engine, Yoga and
 * Emscripten's system libraries), by component.
 */
export async function engineWasmLicenses(): Promise<
  readonly {
    readonly name: string;
    readonly license: string;
    readonly files: readonly string[];
  }[]
> {
  const artifact = await engine({ target: 'web' });
  return artifact.licenses;
}
