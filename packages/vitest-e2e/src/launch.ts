import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

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
import { inject, onTestFinished, type TestContext } from 'vitest';

import { resultsDir } from './results';

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
): T & { plugin: string; cwd: string } {
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

/** How long a failed test waits for each thing it saves. */
const REPORT_TIMEOUT = 2000;

/** How many of each failed test have reported, for the names of their files. */
const started = new Map<string, number>();

/** What a person needs to see why a test failed: never fails it another way. */
async function report(
  { task }: TestContext,
  root: string,
  place: number,
  contents: () => Promise<Record<string, string | Uint8Array | undefined>>,
): Promise<void> {
  try {
    const dir = resultsDir(root, task.file.filepath, task.fullTestName);
    if (place === 1) await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const suffix = place === 1 ? '' : `-${place}`;
    for (const [name, data] of Object.entries(await contents())) {
      if (data === undefined) continue;
      const [stem, extension] = name.split('.');
      await writeFile(join(dir, `${stem}${suffix}.${extension}`), data);
    }
    const error = task.result?.errors?.[0];
    const note = `Saved from the plugin: ${dir}`;
    if (error && !error.message.includes(note)) error.message += `\n\n${note}`;
  } catch {
    // The failure itself is what the test reports.
  }
}

/** Started now, and closed when the current test ends, however it ends. */
async function forThisTest<T extends { close(): Promise<unknown> }>(
  root: string,
  start: () => Promise<T>,
  contents: (
    running: T | undefined,
  ) => Promise<Record<string, string | Uint8Array | undefined>>,
): Promise<T> {
  let launching: Promise<T> | undefined;
  // First, so that nothing starts outside a test, where it would never close.
  onTestFinished(async (context) => {
    const running = await launching?.catch(() => undefined);
    if (context.task.result?.state === 'fail') {
      const { id } = context.task;
      const place = (started.get(id) ?? 0) + 1;
      started.set(id, place);
      await report(context, root, place, () => contents(running));
    }
    await running?.close();
  }, CLOSE_TIMEOUT);
  launching = start();
  return launching;
}

/** The lines a host or plugin logs, for a failed test's report. */
function logged<T extends { onLog?: (line: string) => void }>(options: T) {
  const lines: string[] = [];
  return {
    lines,
    options: {
      ...options,
      onLog: (line: string) => {
        lines.push(line);
        options.onLog?.(line);
      },
    },
  };
}

const text = (lines: readonly string[]) =>
  lines.length === 0 ? undefined : `${lines.join('\n')}\n`;

/**
 * Starts a Debug build of a Soundor plugin in the VST3 host with its editor
 * open and its UI connected, for this test: it closes when the test ends. A
 * test that fails leaves a screenshot, the UI tree and the host's log.
 */
export async function launchPlugin(
  options: LaunchPluginOptions = {},
): Promise<Vst3Plugin> {
  const resolved = located(options);
  const log = logged(resolved);
  return forThisTest(
    resolved.cwd,
    () => launch(log.options),
    async (plugin) => {
      const call = { timeout: REPORT_TIMEOUT };
      const [screenshot, tree] = await Promise.allSettled([
        plugin?.screenshot(call),
        plugin?.driver.getTree(call),
      ]);
      return {
        'screenshot.png':
          screenshot.status === 'fulfilled'
            ? screenshot.value?.data
            : undefined,
        'tree.json':
          tree.status === 'fulfilled' && tree.value
            ? JSON.stringify(tree.value, null, 2)
            : undefined,
        'host.log': text(log.lines),
      };
    },
  );
}

/**
 * Loads any VST3 plugin in the host, without an editor, a display or
 * DevTools, for this test: it closes when the test ends. A test that fails
 * leaves the host's log.
 */
export async function launchHost(
  options: LaunchHostOptions = {},
): Promise<Vst3Host> {
  const resolved = located(options);
  const log = logged(resolved);
  return forThisTest(
    resolved.cwd,
    () => startHost(log.options),
    async () => ({ 'host.log': text(log.lines) }),
  );
}
