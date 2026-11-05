import { resolve } from 'node:path';

import {
  launch,
  type Vst3LaunchOptions,
  type Vst3Plugin,
} from '@soundor/driver/vst3';
import {
  launchHost as startHost,
  type LaunchOptions,
  type Vst3Host,
} from '@soundor/vst3-host';
import { inject, onTestFinished } from 'vitest';

declare module 'vitest' {
  interface ProvidedContext {
    /** What `soundor()` hands to the tests. */
    soundorE2E: { vst3: string; root: string };
  }
}

/** Options of {@link launchPlugin}; `plugin` defaults to `soundor({ vst3 })`. */
export type LaunchPluginOptions = Omit<Vst3LaunchOptions, 'plugin'> & {
  plugin?: string;
};

/** Options of {@link launchHost}; `plugin` defaults to `soundor({ vst3 })`. */
export type LaunchHostOptions = Omit<LaunchOptions, 'plugin' | 'editor'> & {
  plugin?: string;
};

// Long enough for the host's own close, which ends in killing the process.
const CLOSE_TIMEOUT = 15_000;

function located<T extends { plugin?: string; cwd?: string }>(
  options: T,
): T & { plugin: string } {
  const configured = inject('soundorE2E');
  const plugin = options.plugin ?? configured?.vst3;
  if (plugin === undefined)
    throw new Error(
      'Which plugin? Add soundor({ vst3: "path/to/Plugin.vst3" }) from @soundor/vitest-e2e to the Vitest config, or pass { plugin }',
    );
  const root = configured?.root ?? process.cwd();
  return {
    ...options,
    plugin: resolve(root, plugin),
    cwd: options.cwd ?? root,
  };
}

/** Started now, and closed when the current test ends, however it ends. */
async function forThisTest<T extends { close(): Promise<unknown> }>(
  start: () => Promise<T>,
): Promise<T> {
  let started: Promise<T> | undefined;
  // First, so that nothing starts outside a test, where it would never close.
  onTestFinished(async () => {
    const running = await started?.catch(() => undefined);
    await running?.close();
  }, CLOSE_TIMEOUT);
  started = start();
  return started;
}

/**
 * Starts a Debug build of a Soundor plugin in the VST3 host with its editor
 * open and its UI connected, for this test: it closes when the test ends.
 */
export async function launchPlugin(
  options: LaunchPluginOptions = {},
): Promise<Vst3Plugin> {
  const resolved = located(options);
  return forThisTest(() => launch(resolved));
}

/**
 * Loads any VST3 plugin in the host, without an editor, a display or
 * DevTools, for this test: it closes when the test ends.
 */
export async function launchHost(
  options: LaunchHostOptions = {},
): Promise<Vst3Host> {
  const resolved = located(options);
  return forThisTest(() => startHost(resolved));
}
