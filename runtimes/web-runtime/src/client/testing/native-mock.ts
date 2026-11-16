/** Test-only native call mocking. Production methods are always Rust. */
import { hostContext } from '../context';
import { nativeArguments, nativeResult, nativeTypes } from '../native-values';
import type { WasmController } from '../wasm-controller';

export type NativeMock = {
  [
    K in keyof typeof import('soundor:native') as (typeof import('soundor:native'))[K] extends (
      ...args: never[]
    ) => unknown
      ? K
      : never
  ]: (typeof import('soundor:native'))[K];
};

export function installNative(module: { native: NativeMock }): void {
  const context = hostContext();
  const types = nativeTypes(context.manifest.native.types);
  context.controller = {
    call(method, args) {
      const values = nativeArguments(method, args, types);
      const fn = module.native[method.name as keyof NativeMock] as (
        ...args: unknown[]
      ) => unknown;
      if (method.async)
        return (async () => {
          const value = await fn(...values);
          return nativeResult(method, value, types);
        })();
      return nativeResult(method, fn(...values), types);
    },
  } as WasmController;
}
