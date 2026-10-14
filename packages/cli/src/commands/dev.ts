import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import { outro } from '@clack/prompts';
import { parseConfig, resolveRuntime, runPhase } from '@soundor/config';
import type { DevToolsSettings, UserConfigOptions } from '@soundor/config';
import {
  createCodegenSink,
  createConsoleLogger,
  createNodeFileSystem,
  createProjectPaths,
  rootFromConfigPath,
} from '@soundor/core';
import type { Capability } from '@soundor/devtools-protocol';
import { defineCommand } from 'citty';

import { resolveDevToolsSettings } from '../dev/devtools';
import { tailLog } from '../dev/log-tail';
import { rewriteLocations, SourceMap } from '../dev/source-map';
import { openDevTools } from '../devtools/open';
import {
  startDevToolsServer,
  DevToolsPortError,
  type DevToolsServer,
} from '../devtools/server';
import { watchUi } from '../ui/bundle';
import { runGen } from './gen';

const CONFIG_FILENAME = 'soundor.config.ts';

export interface RunDevOptions {
  cwd?: string;
  configPath?: string;
  runtime: string;
  userConfig?: UserConfigOptions;
}

export interface RunDevResult {
  runtime: string;
  /** Resolved opt-in for the session server (provided by the next lifecycle layer). */
  devtools?: DevToolsSettings;
}

export async function runDev(options: RunDevOptions): Promise<RunDevResult> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = resolveConfigPath(cwd, options.configPath);
  const root = rootFromConfigPath(configPath);
  const logger = createConsoleLogger('soundor');
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

  // The native runtime's frames name /bundle.js, the Web's bundle.mjs.
  let sourceMap: SourceMap | undefined;
  let moduleMap: SourceMap | undefined;
  let sourceMapLoaded = Promise.resolve();
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
      const load = (file: string): Promise<SourceMap | undefined> =>
        SourceMap.load(resolve(bundle.dir, file), root).then(
          (map) => map,
          () => undefined,
        );
      sourceMapLoaded = Promise.all([
        load('bundle.js.map'),
        load('bundle.mjs.map'),
      ]).then(([native, module]) => {
        sourceMap = native;
        moduleMap = module;
      });
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
  await sourceMapLoaded;

  const controller = new AbortController();
  let debug: DevToolsServer | undefined;
  if (devtools) {
    try {
      debug = await startDevToolsServer({
        projectRoot: root,
        settings: devtools,
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
      if (devtools.open)
        await openDevTools(debug.browserLaunchUrl()).catch(() =>
          logger.warn(
            `Could not open DevTools automatically. Open ${debug!.url} in your browser.`,
          ),
        );
    } catch (error) {
      if (error instanceof DevToolsPortError) {
        watcher?.close();
        throw error;
      }
      logger.warn(
        'DevTools could not start; continuing normal runtime development. Check local listener and user config permissions.',
      );
    }
  }

  const uiLogger = logger.child('ui');
  const tail = await tailLog(logFile, (entry) => {
    let message = entry.message;
    if (sourceMap !== undefined) message = rewriteLocations(message, sourceMap);
    if (moduleMap !== undefined)
      message = rewriteLocations(message, moduleMap, 'bundle.mjs');
    uiLogger[entry.level](`${entry.source}: ${message}`);
    debug?.publishLog({ ...entry, message });
  }).catch(async (error: unknown) => {
    watcher?.close();
    await debug?.close();
    throw error;
  });

  const onSigint = (): void => {
    logger.info('Stopping dev mode');
    controller.abort();
  };

  process.once('SIGINT', onSigint);
  try {
    await runPhase(resolved, 'dev', config, {
      paths,
      fs,
      logger: logger.child(options.runtime),
      codegen: createCodegenSink(),
      mode: 'debug',
      signal: controller.signal,
      devtools: debug?.connection,
      ui: watcher && {
        dir: uiDir,
        entry: 'bundle.js',
        module: 'bundle.mjs',
        live: { logFile },
      },
    });
  } finally {
    process.removeListener('SIGINT', onSigint);
    watcher?.close();
    await tail.poll().catch(() => {});
    tail.close();
    await debug?.close();
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
