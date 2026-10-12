import {
  initializeTestContext,
  disposeTestContext,
  type RuntimeOptions,
} from '@soundor/test-runtime';
import type { Environment } from 'vitest/runtime';

export default {
  name: 'soundor',
  viteEnvironment: 'ssr',
  setup(global, options) {
    if (!options.soundor?.configured)
      throw new Error(
        'environment: "soundor" requires plugins: [soundor()] from @soundor/vitest',
      );
    initializeTestContext(options.soundor.runtime as RuntimeOptions, global);
    const installReportError = typeof global.reportError !== 'function';
    const previousReportError = Object.getOwnPropertyDescriptor(
      global,
      'reportError',
    );
    if (installReportError)
      Object.defineProperty(global, 'reportError', {
        configurable: true,
        writable: true,
        value: (error: unknown) =>
          (global.queueMicrotask ?? queueMicrotask)(() => {
            throw error;
          }),
      });
    return {
      async teardown() {
        try {
          await disposeTestContext(global);
        } finally {
          if (installReportError) {
            if (previousReportError)
              Object.defineProperty(global, 'reportError', previousReportError);
            else delete global.reportError;
          }
        }
      },
    };
  },
} satisfies Environment;
