import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Plugin } from 'vitest/config';

export interface SoundorE2EOptions {
  /** The `.vst3` bundle the tests load, from the project root. Nothing here
      builds it: `soundor build juce --debug` makes a Debug build of a Soundor
      plugin, in `.soundor/debug/juce/`. */
  vst3: string;
}

const setup = fileURLToPath(new URL('./setup.mjs', import.meta.url));
const globalSetup = fileURLToPath(
  new URL('./global-setup.mjs', import.meta.url),
);
// A real plugin starts, reacts and closes in real time.
const TEST_TIMEOUT = 30_000;
const POLL_TIMEOUT = 5000;

/** Tests a built plugin: tells them which, and adds the locator matchers. */
export function soundor(options: SoundorE2EOptions): Plugin {
  return {
    name: 'soundor:vitest-e2e',
    apply: 'serve',
    config(config) {
      if (config.test?.environment === 'soundor')
        throw new Error(
          'End-to-end tests run in Node, beside the real plugin: remove test.environment "soundor" from this project. The simulated runtime has its own project, with soundor() from @soundor/vitest.',
        );
      const root = resolve(config.root ?? process.cwd());
      return {
        test: {
          setupFiles: [setup],
          globalSetup: [globalSetup],
          provide: {
            soundorE2E: { vst3: resolve(root, options.vst3), root },
          },
          ...(config.test?.testTimeout === undefined
            ? { testTimeout: TEST_TIMEOUT }
            : {}),
          ...(config.test?.expect?.poll?.timeout === undefined
            ? { expect: { poll: { timeout: POLL_TIMEOUT } } }
            : {}),
        },
      };
    },
  };
}
