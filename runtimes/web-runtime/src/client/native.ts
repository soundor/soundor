/** soundor:native dispatches the generated contract to the instance's Rust controller. */
import { hostContext } from './context';
import type { WebNativeMethod } from './manifest';

export function nativeMethod(
  method: WebNativeMethod,
): (...args: unknown[]) => unknown {
  const fn = (...args: unknown[]) => {
    const controller = hostContext().controller;
    if (controller === undefined)
      throw new Error('The Rust controller is not initialized');
    return controller.call(method, args);
  };
  Object.defineProperty(fn, 'length', { value: method.args.length });
  return Object.defineProperty(fn, 'name', { value: method.name });
}
