import { createRoot, type Root } from '@soundor/react';
import {
  getTestRuntime,
  registerTestCleanup,
  type TestNode,
} from '@soundor/test-runtime';
import {
  act as reactAct,
  createElement,
  type ReactNode,
  type ComponentType,
} from 'react';

import {
  waitFor as rawWaitFor,
  advanceTime as rawAdvanceTime,
  type WaitOptions,
  type UpdateWrapper,
} from '../async';
import { fireEvent as rawFireEvent } from '../events/fire';
import { createUser, type UserOptions } from '../events/user';
import { createQueries, resolveNode, type NodeTarget } from '../queries';
import {
  testParameters as rawTestParameters,
  testHost as rawTestHost,
} from '../setup';
export type {
  TextMatch,
  MatchOptions,
  RoleOptions,
  NodeTarget,
} from '../queries';
export type { UserOptions, PointerAction } from '../events/user';
export type {
  PointerOptions,
  KeyOptions,
  InputOptions,
  Modifiers,
} from '../events/fire';
export type { WaitOptions } from '../async';

// Serialized only within this worker; file concurrency uses independent workers.
const wrap: UpdateWrapper = async (action) => {
  const global = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previous = global.IS_REACT_ACT_ENVIRONMENT;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await reactAct(async () => {
      await action();
    });
  } finally {
    global.IS_REACT_ACT_ENVIRONMENT = previous;
  }
};
export const act = wrap;
const mounted = new Set<() => Promise<void>>();
export interface RenderOptions {
  container?: NodeTarget;
  wrapper?: ComponentType<{ children?: ReactNode }>;
}
export async function render(element: ReactNode, options: RenderOptions = {}) {
  const runtime = getTestRuntime();
  const container = options.container
    ? resolveNode(options.container)
    : runtime.create('view');
  if (!options.container) runtime.root.appendChild(container);
  let renderer!: Root,
    unmounted = false;
  const content = (value: ReactNode) =>
    options.wrapper ? createElement(options.wrapper, null, value) : value;
  const removeCleanup = registerTestCleanup(() => unmount());
  async function unmount() {
    if (unmounted) return;
    unmounted = true;
    mounted.delete(unmount);
    removeCleanup();
    if (!runtime.isDisposed)
      await wrap(() => {
        renderer?.unmount();
        if (!options.container) container.remove();
      });
  }
  mounted.add(unmount);
  try {
    await wrap(() => {
      renderer = createRoot(container as never);
      renderer.render(content(element));
    });
  } catch (error) {
    try {
      await unmount();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Soundor render and cleanup failed',
      );
    }
    throw error;
  }
  return {
    container: container as TestNode,
    ...createQueries(options.container ? container : undefined, wrap),
    rerender: async (next: ReactNode) => {
      if (unmounted)
        throw new Error('Cannot rerender an unmounted Soundor root');
      runtime.assertActive();
      await wrap(() => {
        renderer.render(content(next));
      });
    },
    unmount,
  };
}
export async function cleanup(): Promise<void> {
  const errors: unknown[] = [];
  for (const unmount of [...mounted].reverse()) {
    try {
      await unmount();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    throw new AggregateError(errors, 'Soundor React cleanup failed');
}
export const screen = createQueries(undefined, wrap);
export const within = (target: NodeTarget) => createQueries(target, wrap);
export const userEvent = {
  setup: (options?: UserOptions) => createUser(options, wrap),
};
export const waitFor = <T>(
  callback: () => T | Promise<T>,
  options?: WaitOptions,
) => rawWaitFor(callback, options, wrap);
export const advanceTime = (milliseconds: number) =>
  rawAdvanceTime(milliseconds, wrap);
// Preserve native synchronous dispatch while committing React updates.
function syncUpdate<T>(action: () => T): T {
  const global = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previous = global.IS_REACT_ACT_ENVIRONMENT;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  let value!: T;
  try {
    reactAct(() => {
      value = action();
    });
    return value;
  } finally {
    global.IS_REACT_ACT_ENVIRONMENT = previous;
  }
}
export const fireEvent: typeof rawFireEvent = new Proxy(rawFireEvent, {
  apply: (target, thisArg, args) =>
    syncUpdate(() => Reflect.apply(target, thisArg, args)),
  get: (target, key) => {
    const value = Reflect.get(target, key);
    return typeof value === 'function'
      ? (...args: unknown[]) =>
          syncUpdate(() => Reflect.apply(value, target, args))
      : value;
  },
});

export { mockNative } from '../setup';
export const testParameters: typeof rawTestParameters = {
  set: (id, value) => syncUpdate(() => rawTestParameters.set(id, value)),
};
export const testHost: typeof rawTestHost = {
  set: (state) => syncUpdate(() => rawTestHost.set(state)),
};
