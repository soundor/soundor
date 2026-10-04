/**
 * `soundor:native` in the browser. The plugin's calls go straight to the
 * project's TypeScript implementation (`runtimes/web/src/native.ts`): the
 * same arguments, results, exceptions and promises, nothing serialized.
 */

import { hostContext } from './context';
import type { WebNativeMethod } from './manifest';

/** An opaque reference to a native object, as `soundor:native` declares handles. */
export interface WebNativeHandle<Name extends string> {
  readonly __soundorHandle: Name;
}

/** Makes and opens handles of one type (the generated `Preset` and the like). */
export interface WebNativeHandleType<Name extends string> {
  /** A new handle to `value`. Plugin code can pass it around, not look inside. */
  wrap(value: unknown): WebNativeHandle<Name>;
  /** The value a handle of this type refers to; a TypeError for anything else. */
  unwrap<T = unknown>(handle: WebNativeHandle<Name>): T;
}

/** The values behind handles; a handle is only valid if it is in here. */
const handles = new WeakMap<object, { name: string; value: unknown }>();

/** Defines a handle type; the generated native.ts calls it per handle. */
export function defineHandle<Name extends string>(
  name: Name,
): WebNativeHandleType<Name> {
  return Object.freeze({
    wrap(value: unknown): WebNativeHandle<Name> {
      const handle = Object.freeze({
        [Symbol.toStringTag]: name,
      }) as unknown as WebNativeHandle<Name>;
      handles.set(handle, { name, value });
      return handle;
    },
    unwrap<T>(handle: WebNativeHandle<Name>): T {
      const entry =
        typeof handle === 'object' && handle !== null
          ? handles.get(handle)
          : undefined;
      if (entry === undefined || entry.name !== name) {
        throw new TypeError(`expected a ${name} handle`);
      }
      return entry.value as T;
    },
  });
}

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

/**
 * The function `soundor:native` exports for `method`: it calls the
 * implementation as it is. An async method always returns a promise.
 */
export function nativeMethod(
  method: WebNativeMethod,
): (...args: unknown[]) => unknown {
  const call = (args: unknown[]): unknown => {
    if (implementation === undefined) {
      throw new Error(
        `soundor:native: ${method.name}() has no Web implementation. Implement it in runtimes/web/src/native.ts and pass it to startSoundorWebHost({ native }).`,
      );
    }
    return (
      implementation[method.name] as (...args: unknown[]) => unknown
    ).apply(implementation, args);
  };
  const fn = method.async
    ? async (...args: unknown[]) => call(args)
    : (...args: unknown[]) => call(args);
  return Object.defineProperty(fn, 'name', { value: method.name });
}
