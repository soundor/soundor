import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The module `pnpm build:wasm` writes. */
export const wasmPath = fileURLToPath(
  new URL('../../build/wasm/web/soundor-core.wasm', import.meta.url),
);

/** The module's bytes, or why there are none. */
export function wasmBytes(): Uint8Array<ArrayBuffer> {
  if (!existsSync(wasmPath))
    throw new Error(
      `${wasmPath} is missing: build it first with \`pnpm --filter @soundor/engine build:wasm\``,
    );
  return new Uint8Array(readFileSync(wasmPath));
}

let compiled: Promise<WebAssembly.Module> | undefined;

/** The module, compiled once for all of a file's engines. */
export function wasmModule(): Promise<WebAssembly.Module> {
  compiled ??= WebAssembly.compile(wasmBytes());
  return compiled;
}
