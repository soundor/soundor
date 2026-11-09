/**
 * `soundor:native` in the browser. The plugin's calls go to the project's
 * TypeScript implementation (`runtimes/web/src/native.ts`), their arguments
 * and results checked and converted as the JUCE runtime's bindings do them
 * (./native-values): nothing serialized, exceptions and promises as they are.
 */

import { hostContext } from './context';
import type { WebNativeMethod } from './manifest';
import {
  nativeArguments,
  nativeResult,
  nativeTypes,
  type NativeTypes,
} from './native-values';

/** What the project's native.ts exports: the implementation, by method name. */
export type NativeImplementation = Readonly<Record<string, unknown>>;

let implementation: NativeImplementation | undefined;

/**
 * Installs the project's implementation, checking it implements every
 * declared method. Throws, naming what is missing, if not.
 */
export function installNative(module: unknown): void {
  const exports = module as {
    native?: NativeImplementation;
    default?: NativeImplementation;
  } | null;
  const candidate = exports?.native ?? exports?.default;
  const methods = hostContext().manifest.native.methods;
  if (typeof candidate !== 'object' || candidate === null) {
    throw new TypeError(
      "runtimes/web/src/native.ts must export the native API implementation as 'native'",
    );
  }
  const missing = methods.filter(
    (method) => typeof candidate[method.name] !== 'function',
  );
  if (missing.length > 0) {
    throw new TypeError(
      `runtimes/web/src/native.ts does not implement ${missing.map((method) => `${method.name}()`).join(', ')}`,
    );
  }
  implementation = candidate;
}

let declaredTypes: { manifest: object; types: NativeTypes } | undefined;

/** The declared types of the page's manifest. */
function types(): NativeTypes {
  const { manifest } = hostContext();
  if (declaredTypes?.manifest !== manifest) {
    declaredTypes = { manifest, types: nativeTypes(manifest.native.types) };
  }
  return declaredTypes.types;
}

/**
 * The function `soundor:native` exports for `method`. It checks the
 * arguments (throwing, as the native bindings do, before any promise exists),
 * calls the implementation with their converted values, and checks what it
 * returns. An async method always returns a promise.
 */
export function nativeMethod(
  method: WebNativeMethod,
): (...args: unknown[]) => unknown {
  const implementationOf = () => {
    if (implementation === undefined) {
      throw new Error(
        `soundor:native: ${method.name}() has no Web implementation. Implement it in runtimes/web/src/native.ts and pass it to startSoundorWebHost({ native }).`,
      );
    }
    return implementation[method.name] as (...args: unknown[]) => unknown;
  };
  const fn = method.async
    ? (...args: unknown[]) => {
        const values = nativeArguments(method, args, types());
        return (async () => {
          const result: unknown = await implementationOf().apply(
            implementation,
            values,
          );
          return nativeResult(method, result, types());
        })();
      }
    : (...args: unknown[]) => {
        const values = nativeArguments(method, args, types());
        const result = implementationOf().apply(implementation, values);
        return nativeResult(method, result, types());
      };
  Object.defineProperty(fn, 'length', { value: method.args.length });
  return Object.defineProperty(fn, 'name', { value: method.name });
}
