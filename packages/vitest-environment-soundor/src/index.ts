import {
  initializeTestContext,
  disposeTestContext,
  type RuntimeOptions,
} from '@soundor/test-runtime';
import type { Environment } from 'vitest/runtime';

import { createFrames } from './frames';

export default {
  name: 'soundor',
  viteEnvironment: 'ssr',
  setup(global, options) {
    if (!options.soundor?.configured)
      throw new Error(
        'environment: "soundor" requires plugins: [soundor()] from @soundor/vitest',
      );
    const context = initializeTestContext(
      options.soundor.runtime as RuntimeOptions,
      global,
    );
    const restores: (() => void)[] = [];
    function install(name: string, value: unknown, writable = true) {
      const previous = Object.getOwnPropertyDescriptor(global, name);
      Object.defineProperty(global, name, {
        value,
        writable,
        configurable: true,
      });
      restores.push(() => {
        if (previous) Object.defineProperty(global, name, previous);
        else delete global[name];
      });
    }
    if (typeof global.reportError !== 'function')
      install('reportError', (error: unknown) =>
        (global.queueMicrotask ?? queueMicrotask)(() => {
          throw error;
        }),
      );
    if (
      typeof global.requestAnimationFrame !== 'function' ||
      typeof global.cancelAnimationFrame !== 'function'
    ) {
      const frames = createFrames(context, (error) =>
        global.reportError(error),
      );
      install('requestAnimationFrame', frames.requestAnimationFrame);
      install('cancelAnimationFrame', frames.cancelAnimationFrame);
    }
    if (typeof global.devicePixelRatio !== 'number')
      install('devicePixelRatio', 1, false);

    return {
      async teardown() {
        try {
          await disposeTestContext(global);
        } finally {
          for (const restore of restores.reverse()) restore();
        }
      },
    };
  },
} satisfies Environment;
