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
import { createServer, type ViteDevServer } from 'vite';

import {
  SOUNDOR_PARAMS_MODULE,
  soundorBridgePlugin,
} from '../vite/bridge-plugin';
import { runGen } from './gen';

const CONFIG_FILENAME = 'soundor.config.ts';

export interface RunDevOptions {
  cwd?: string;
  configPath?: string;
  runtime: string;
}

export interface RunDevResult {
  runtime: string;
  uiUrl: string;
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
  const bridgeEntry = resolved.runtime.bridgeModule?.();
  const vite = await startVite(root, logger.child('ui'), bridgeEntry);
  const uiUrl = firstViteUrl(vite);
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
      dev: {
        ui: {
          kind: 'vite',
          url: uiUrl,
        },
      },
    });
  } finally {
    process.removeListener('SIGINT', onSigint);
    await vite.close();
  }

  return { runtime: options.runtime, uiUrl };
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
    const result = await runDev({
      runtime,
      configPath:
        typeof args['config'] === 'string' ? args['config'] : undefined,
    });
    outro(`UI dev server: ${result.uiUrl}`);
  },
});

async function startVite(
  root: string,
  logger: ReturnType<typeof createConsoleLogger>,
  bridgeEntry?: string,
): Promise<ViteDevServer> {
  const server = await createServer({
    root,
    plugins: [
      soundorBridgePlugin({
        entry: bridgeEntry,
        paramsModule: SOUNDOR_PARAMS_MODULE,
      }),
    ],
    customLogger: {
      hasWarned: false,
      hasErrorLogged: () => false,
      clearScreen: () => {},
      info: (message) => {
        logger.info(stripTrailingNewline(message));
      },
      warn: (message) => {
        logger.warn(stripTrailingNewline(message));
      },
      warnOnce: (message) => {
        logger.warn(stripTrailingNewline(message));
      },
      error: (message) => {
        logger.error(stripTrailingNewline(message));
      },
    },
  });
  await server.listen();
  return server;
}

function firstViteUrl(server: ViteDevServer): string {
  const url = server.resolvedUrls?.local[0] ?? server.resolvedUrls?.network[0];
  if (url === undefined) {
    throw new Error('Vite dev server started but did not report a local URL.');
  }
  return url;
}

function stripTrailingNewline(message: string): string {
  return message.replace(/\n$/, '');
}

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
