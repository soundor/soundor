import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { outro } from '@clack/prompts';
import { parseConfig, resolveRuntime, runPhase } from '@soundor/config';
import {
  createCodegenSink,
  createConsoleLogger,
  createNodeFileSystem,
  createProjectPaths,
  rootFromConfigPath,
} from '@soundor/core';
import { defineCommand } from 'citty';

import { runGen } from './gen';

const CONFIG_FILENAME = 'soundor.config.ts';

export interface RunDevOptions {
  cwd?: string;
  configPath?: string;
  runtime: string;
}

export interface RunDevResult {
  runtime: string;
}

export async function runDev(options: RunDevOptions): Promise<RunDevResult> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = resolveConfigPath(cwd, options.configPath);
  const root = rootFromConfigPath(configPath);
  const logger = createConsoleLogger('soundor');
  const config = await parseConfig({ path: configPath });
  const resolved = resolveRuntime(config, options.runtime);

  await runGen({ cwd, configPath });

  const fs = createNodeFileSystem(root);
  const paths = createProjectPaths({
    root,
    config: configPath,
    runtimeId: options.runtime,
  });
  const controller = new AbortController();
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
    });
  } finally {
    process.removeListener('SIGINT', onSigint);
  }

  return { runtime: options.runtime };
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
