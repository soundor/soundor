import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import { outro } from '@clack/prompts';
import { parseConfig, resolveRuntime, runPhase } from '@soundor/config';
import type {
  DevSessionContext,
  DevShortcut,
  DevSummaryRow,
  DevToolsSettings,
  UserConfigOptions,
} from '@soundor/config';
import {
  createCodegenSink,
  createNodeFileSystem,
  createProjectPaths,
  rootFromConfigPath,
} from '@soundor/core';
import type { Capability } from '@soundor/devtools-protocol';
import {
  startDevToolsServer,
  DevToolsPortError,
  type DevToolsServer,
} from '@soundor/devtools-server';
import { defineCommand } from 'citty';

import { copyToClipboard } from '../dev/clipboard';
import { resolveDevToolsSettings } from '../dev/devtools';
import { tailLog } from '../dev/log-tail';
import { bindShortcuts } from '../dev/shortcuts';
import { rewriteLocations, SourceMap } from '../dev/source-map';
import { createDevTerminal, formatSummary } from '../dev/terminal';
import { resolveDevToolsClientDist } from '../devtools/client';
import { openDevTools } from '../devtools/open';
import { watchUi } from '../ui/bundle';
import { cliVersion } from '../version';
import { runGen } from './gen';

const CONFIG_FILENAME = 'soundor.config.ts';

export interface RunDevOptions {
  cwd?: string;
  configPath?: string;
  runtime: string;
  userConfig?: UserConfigOptions;
  /**
   * Collapse the build output and bind shortcuts. Defaults to whether stdin
   * and stdout are a terminal (outside CI).
   */
  interactive?: boolean;
}

export interface RunDevResult {
  runtime: string;
  /** Resolved opt-in for the session server (provided by the next lifecycle layer). */
  devtools?: DevToolsSettings;
}

export async function runDev(options: RunDevOptions): Promise<RunDevResult> {
  const started = performance.now();
  const cwd = options.cwd ?? process.cwd();
  const configPath = resolveConfigPath(cwd, options.configPath);
  const root = rootFromConfigPath(configPath);
  const interactive =
    options.interactive ??
    (process.stdin.isTTY === true &&
      process.stdout.isTTY === true &&
      process.env['CI'] === undefined);
  const config = await parseConfig({ path: configPath });
  const resolved = resolveRuntime(config, options.runtime);
  const devtools = await resolveDevToolsSettings(
    resolved.runtime,
    options.userConfig,
  );

  await runGen({ cwd, configPath });

  const fs = createNodeFileSystem(root);
  const paths = createProjectPaths({
    root,
    config: configPath,
    runtimeId: options.runtime,
  });
  const uiDir = resolve(root, '.soundor', 'ui', 'development');
  // The plugin's UI log, shown here whatever process the plugin runs in.
  const logFile = resolve(root, '.soundor', 'dev', 'ui.log');
  await mkdir(dirname(logFile), { recursive: true });
  await writeFile(logFile, '');
  const terminal = createDevTerminal({
    scope: 'soundor',
    buildLog: resolve(root, '.soundor', 'dev', 'build.log'),
    collapse: interactive,
  });
  const { logger } = terminal;

  // Stack frames in the plugin's log are mapped back to the sources: the
  // Web's name the ES module, bundle.mjs; a runtime that runs another form of
  // it maps its own (live.sourceMap()).
  let moduleMap: SourceMap | undefined;
  let moduleMapLoaded = Promise.resolve();
  const runtimeMaps = new Map<string, SourceMap>();
  const buildListeners = new Set<() => void>();
  let built = false;
  const watcher = watchUi({
    root,
    mode: 'development',
    outDir: uiDir,
    onBuild(bundle, milliseconds) {
      logger.info(
        built
          ? `Rebuilt the UI in ${milliseconds} ms`
          : `Bundled the UI -> ${bundle.dir}`,
      );
      built = true;
      moduleMapLoaded = SourceMap.load(
        resolve(bundle.dir, `${bundle.module}.map`),
        root,
      ).then(
        (map) => {
          moduleMap = map;
        },
        () => {
          moduleMap = undefined;
        },
      );
      for (const listener of buildListeners) {
        try {
          listener();
        } catch (error) {
          logger.error(error instanceof Error ? error.message : String(error));
        }
      }
    },
    onError(error) {
      logger.error(
        `The UI failed to build; the plugin keeps the last good build.\n${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    },
  });
  await watcher?.ready;
  await moduleMapLoaded;

  const controller = new AbortController();
  let debug: DevToolsServer | undefined;
  if (devtools) {
    try {
      debug = await startDevToolsServer({
        projectRoot: root,
        port: devtools.port,
        portFallback: devtools.portSource === 'default',
        staticDir: resolveDevToolsClientDist(),
        developmentOrigin: process.env.SOUNDOR_DEVTOOLS_ORIGIN,
        signal: controller.signal,
        supportedCapabilities: Object.entries(
          resolved.runtime.capabilities!.devtools!,
        )
          .filter(([, value]) => value === true)
          .map(([name]) => name as Capability),
        onTarget: (target) =>
          logger.info(`Connected: ${target.name} — ${target.runtime}`),
      });
      logger.info(`DevTools: ${debug.url}`);
      logger.info(`DevTools session file: ${debug.descriptorPath}`);
      if (devtools.open)
        await openDevTools(debug.browserLaunchUrl()).catch(() =>
          logger.warn(
            `Could not open DevTools automatically. Open ${debug!.url} in your browser.`,
          ),
        );
    } catch (error) {
      if (error instanceof DevToolsPortError) {
        watcher?.close();
        await terminal.close();
        throw error;
      }
      logger.warn(
        'DevTools could not start; continuing normal runtime development. Check local listener and user config permissions.',
      );
    }
  }

  const server = debug;
  const ownRows: DevSummaryRow[] = [
    { label: 'Plugin', value: config.plugin.name },
    ...(server === undefined ? [] : [{ label: 'DevTools', value: server.url }]),
  ];
  let runtimeRows: readonly DevSummaryRow[] = [];
  let readyOnce = false;
  const printSummary = (readyMs?: number): void =>
    terminal.print(
      formatSummary({
        version: cliVersion(),
        runtime: options.runtime,
        readyMs,
        rows: [...ownRows, ...runtimeRows],
        hint: interactive,
      }),
    );
  const stop = (): void => {
    logger.info('Stopping dev mode');
    controller.abort();
  };
  const shortcuts: DevShortcut[] = [
    {
      key: 'u',
      description: 'show the summary and URLs',
      action: () => printSummary(),
    },
    ...(server === undefined
      ? []
      : [
          {
            key: 'o',
            description: 'open DevTools, signed in',
            action: () =>
              openDevTools(server.browserLaunchUrl()).catch(() =>
                logger.warn(
                  'Could not open a browser. Press c + enter to copy a signed-in DevTools link instead.',
                ),
              ),
          },
          {
            key: 'c',
            description: 'copy a signed-in DevTools link',
            action: async () => {
              const target = await copyToClipboard(server.browserLaunchUrl());
              logger.info(
                `${target === 'system' ? 'Copied a DevTools link' : 'Asked the terminal to copy a DevTools link'}; it signs in one browser tab within a minute.`,
              );
            },
          },
        ]),
    { key: 'q', description: 'quit', action: stop },
  ];
  const builtIn = new Set(['h', ...shortcuts.map((entry) => entry.key)]);
  const session: DevSessionContext = {
    ready(rows = []) {
      runtimeRows = rows;
      terminal.settle();
      printSummary(readyOnce ? undefined : performance.now() - started);
      readyOnce = true;
    },
    shortcut(shortcut) {
      if (builtIn.has(shortcut.key)) {
        logger.warn(
          `Ignoring the runtime's shortcut '${shortcut.key}': soundor dev uses that key.`,
        );
        return;
      }
      const index = shortcuts.findIndex((entry) => entry.key === shortcut.key);
      if (index === -1) shortcuts.splice(-1, 0, shortcut);
      else shortcuts[index] = shortcut;
    },
  };

  const uiLogger = logger.child('ui');
  const tail = await tailLog(logFile, (entry) => {
    let message = entry.message;
    for (const [file, map] of runtimeMaps)
      message = rewriteLocations(message, map, file);
    if (moduleMap !== undefined)
      message = rewriteLocations(message, moduleMap, 'bundle.mjs');
    uiLogger[entry.level](`${entry.source}: ${message}`);
    debug?.publishLog({ ...entry, message });
  }).catch(async (error: unknown) => {
    watcher?.close();
    await debug?.close();
    await terminal.close();
    throw error;
  });

  process.once('SIGINT', stop);
  const unbind = interactive
    ? bindShortcuts({
        shortcuts: () => shortcuts,
        print: (text) => terminal.print(text),
        onError: (error) =>
          logger.error(error instanceof Error ? error.message : String(error)),
      })
    : undefined;
  try {
    await runPhase(resolved, 'dev', config, {
      paths,
      fs,
      logger: logger.child(options.runtime),
      codegen: createCodegenSink(),
      mode: 'debug',
      signal: controller.signal,
      devtools: debug?.connection,
      session,
      ui: watcher && {
        dir: uiDir,
        module: 'bundle.mjs',
        live: {
          logFile,
          onBuild(listener) {
            buildListeners.add(listener);
            return () => {
              buildListeners.delete(listener);
            };
          },
          async sourceMap(file, mapFile) {
            runtimeMaps.set(file, await SourceMap.load(mapFile, root));
          },
        },
      },
    });
  } catch (error) {
    terminal.flush();
    throw error;
  } finally {
    process.removeListener('SIGINT', stop);
    unbind?.();
    watcher?.close();
    await tail.poll().catch(() => {});
    tail.close();
    await debug?.close();
    await terminal.close();
  }

  return {
    runtime: options.runtime,
    ...(devtools === undefined ? {} : { devtools }),
  };
}

export const devCommand = defineCommand({
  meta: {
    name: 'dev',
    description: 'Run development workflow for a runtime',
  },
  args: {
    runtime: {
      type: 'positional',
      description: 'Runtime to use (e.g. juce)',
      required: true,
    },
    config: {
      type: 'string',
      description: 'Path to soundor.config.ts',
    },
  },
  async run({ args }) {
    const runtime = String(args['runtime']);
    console.info(`Starting dev mode for runtime: ${runtime}`);
    await runDev({
      runtime,
      configPath:
        typeof args['config'] === 'string' ? args['config'] : undefined,
    });
    outro(`Stopped dev mode for runtime: ${runtime}`);
  },
});

function resolveConfigPath(cwd: string, configPath?: string): string {
  if (configPath === undefined) return locateConfig(cwd);
  return isAbsolute(configPath) ? configPath : resolve(cwd, configPath);
}

function locateConfig(cwd: string): string {
  let dir = resolve(cwd);
  for (;;) {
    const candidate = resolve(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not find ${CONFIG_FILENAME} in ${resolve(cwd)} or any parent directory.`,
  );
}
