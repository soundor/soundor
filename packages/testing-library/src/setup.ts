import { getTestRuntime, type HostSnapshot } from '@soundor/test-runtime';

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

/** Register a declared simulated native method with an ordinary function or vi.fn(). */
export function mockNative(
  name: string,
  implementation: (...args: never[]) => unknown,
): void {
  getTestRuntime().mockNative(name, implementation);
}
