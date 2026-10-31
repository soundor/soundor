import {
  getTestRuntime,
  type HostSnapshot,
  type ViewSize,
} from '@soundor/test-runtime';

/** Set simulated parameters in plain units using their declared type and range. */
export const testParameters = {
  set(id: string, value: number | boolean | string): void {
    const runtime = getTestRuntime();
    if (!Object.hasOwn(runtime.parameters.byId, id))
      throw new Error(`Unknown Soundor parameter '${id}'`);
    runtime.parameters.byId[id]!.set(value);
  },
};

/** Configure the simulated host snapshot and notify host subscribers. */
export const testHost = {
  set(state: Partial<HostSnapshot>): void {
    getTestRuntime().setHost(state);
  },
};

/**
 * Resize the simulated view, as a user resizing the editor does, and notify
 * viewSize() subscribers (useViewSize()) when it changed.
 */
export const testView = {
  resize(size: Partial<ViewSize>): void {
    getTestRuntime().setViewSize(size);
  },
};

/** Register a declared simulated native method with an ordinary function or vi.fn(). */
export function mockNative(
  name: string,
  implementation: (...args: never[]) => unknown,
): void {
  getTestRuntime().mockNative(name, implementation);
}
