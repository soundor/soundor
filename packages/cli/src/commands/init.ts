import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { outro, spinner } from '@clack/prompts';
import { parseConfig, resolveRuntime, runPhase } from '@soundor/config';
import {
  createCodegenSink,
  createConsoleLogger,
  createNodeFileSystem,
  createProjectPaths,
  rootFromConfigPath,
} from '@soundor/core';
import { defineCommand } from 'citty';

const CONFIG_FILENAME = 'soundor.config.ts';

export interface RunInitOptions {
  cwd?: string;
  configPath?: string;
  runtime?: string;
}

export interface RunInitResult {
  initialized: string[];
}

export async function runInit(
  options: RunInitOptions = {},
): Promise<RunInitResult> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = resolveConfigPath(cwd, options.configPath);
  const root = rootFromConfigPath(configPath);
  const config = await parseConfig({ path: configPath });
  const fs = createNodeFileSystem(root);
  const logger = createConsoleLogger('soundor');
  const runtimes = options.runtime
    ? config.runtimes.filter((runtime) => runtime.id === options.runtime)
    : config.runtimes;

  if (options.runtime !== undefined && runtimes.length === 0) {
    resolveRuntime(config, options.runtime);
  }

  for (const runtimeEntry of runtimes) {
    const resolved = resolveRuntime(config, runtimeEntry.id);
    const paths = createProjectPaths({
      root,
      config: configPath,
      runtimeId: runtimeEntry.id,
    });

    await runPhase(resolved, 'init', config, {
      paths,
      fs,
      logger: logger.child(runtimeEntry.id),
      codegen: createCodegenSink(),
    });
  }

  return { initialized: runtimes.map((runtime) => runtime.id) };
}

export const initCommand = defineCommand({
  meta: {
    name: 'init',
    description: 'Initialize configured runtimes',
  },
  args: {
    runtime: {
      type: 'positional',
      description: 'Runtime to initialize (initializes all if omitted)',
      required: false,
    },
    config: {
      type: 'string',
      description: 'Path to soundor.config.ts',
    },
  },
  async run({ args }) {
    const runtime =
      typeof args['runtime'] === 'string' ? args['runtime'] : undefined;
    const s = spinner();
    s.start(
      runtime === undefined
        ? 'Initializing runtimes'
        : `Initializing ${runtime}`,
    );
    const result = await runInit({
      runtime,
      configPath:
        typeof args['config'] === 'string' ? args['config'] : undefined,
    });
    s.stop(
      result.initialized.length === 1
        ? `Initialized: ${result.initialized[0]}`
        : `Initialized runtimes: ${result.initialized.join(', ')}`,
    );
    outro('Done');
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
