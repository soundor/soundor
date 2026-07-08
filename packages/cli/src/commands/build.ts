import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { outro } from '@clack/prompts';
import {
  ConfigError,
  parseConfig,
  resolveRuntime,
  runPhase,
  type LifecycleContext,
} from '@soundor/config';
import {
  createCodegenSink,
  createConsoleLogger,
  createNodeFileSystem,
  createProjectPaths,
  rootFromConfigPath,
  SoundorError,
  type SoundorErrorCode,
} from '@soundor/core';
import { defineCommand } from 'citty';
import { build as viteBuild } from 'vite';

import { soundorBridgePlugin } from '../vite/bridge-plugin';
import { runGen } from './gen';

const CONFIG_FILENAME = 'soundor.config.ts';

export interface RunBuildOptions {
  cwd?: string;
  configPath?: string;
  runtime?: string;
}

export type RunBuildRuntimeStatus = 'built' | 'failed';

export interface RunBuildRuntimeResult {
  readonly runtime: string;
  readonly status: RunBuildRuntimeStatus;
  readonly error?: unknown;
}

export interface RunBuildResult {
  readonly runtimes: RunBuildRuntimeResult[];
}

export class BuildFailedError extends SoundorError {
  readonly results: RunBuildRuntimeResult[];

  constructor(results: readonly RunBuildRuntimeResult[]) {
    const failures = results.filter((result) => result.status === 'failed');
    super(formatBuildFailureMessage(results), {
      code: aggregateFailureCode(failures),
      issues: failures.map((failure) => ({
        path: `runtimes.${failure.runtime}`,
        message: errorMessage(failure.error),
      })),
    });
    this.name = 'BuildFailedError';
    this.results = [...results];
  }
}

export async function runBuild(
  options: RunBuildOptions = {},
): Promise<RunBuildResult> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = resolveConfigPath(cwd, options.configPath);
  const root = rootFromConfigPath(configPath);
  const config = await parseConfig({ path: configPath });
  const runtimeEntries = options.runtime
    ? [resolveRuntime(config, options.runtime).config]
    : config.runtimes;
  const runtimeIds = runtimeEntries.map((runtime) => runtime.id);

  await runGen({ cwd, configPath, mode: 'production', runtimeIds });

  const fs = createNodeFileSystem(root);
  const logger = createConsoleLogger('soundor');
  const results: RunBuildRuntimeResult[] = [];

  for (const runtimeEntry of runtimeEntries) {
    try {
      const resolved = resolveRuntime(config, runtimeEntry.id);
      const paths = createProjectPaths({
        root,
        config: configPath,
        runtimeId: runtimeEntry.id,
      });

      // The CLI owns the UI bundler: build the React app (embedding the
      // runtime's bridge) and hand the runtime the emitted assets, mirroring
      // how `dev` hands over the Vite dev-server URL. Projects without a UI
      // entry (headless runtimes, tests) simply skip this.
      let build: LifecycleContext['build'];
      if (existsSync(resolve(root, 'index.html'))) {
        const uiDir = join(paths.cache, 'ui');
        await buildViteBundle({
          root,
          outDir: uiDir,
          bridgeEntry: resolved.runtime.bridgeModule?.(),
          logger: logger.child(`${runtimeEntry.id}:ui`),
        });
        build = { ui: { kind: 'vite', dir: uiDir } };
      }

      await runPhase(resolved, 'build', config, {
        paths,
        fs,
        logger: logger.child(runtimeEntry.id),
        codegen: createCodegenSink(),
        mode: 'production',
        build,
      });
      results.push({ runtime: runtimeEntry.id, status: 'built' });
    } catch (error) {
      results.push({ runtime: runtimeEntry.id, status: 'failed', error });
    }
  }

  if (results.some((result) => result.status === 'failed')) {
    throw new BuildFailedError(results);
  }

  return { runtimes: results };
}

export const buildCommand = defineCommand({
  meta: {
    name: 'build',
    description: 'Produce production-ready artifacts',
  },
  args: {
    runtime: {
      type: 'positional',
      description: 'Runtime to build (builds all if omitted)',
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
    const target = runtime ?? 'all runtimes';
    console.info(`Building: ${target}`);
    const result = await runBuild({
      runtime,
      configPath:
        typeof args['config'] === 'string' ? args['config'] : undefined,
    });
    outro(formatRunBuildResult(result));
  },
});

export function formatRunBuildResult(result: RunBuildResult): string {
  const lines = ['Build summary'];
  for (const runtime of result.runtimes) {
    lines.push(`${runtime.status} ${runtime.runtime}`);
  }
  return lines.join('\n');
}

function aggregateFailureCode(
  failures: readonly RunBuildRuntimeResult[],
): SoundorErrorCode {
  if (
    failures.length > 0 &&
    failures.every(
      (failure) =>
        failure.error instanceof SoundorError && failure.error.code === 'ENV',
    )
  ) {
    return 'ENV';
  }
  return 'RUNTIME';
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'runtime build failed';
}

function formatBuildFailureMessage(
  results: readonly RunBuildRuntimeResult[],
): string {
  const failures = results.filter((result) => result.status === 'failed');
  return [
    `Build failed for ${failures.map((failure) => failure.runtime).join(', ')}.`,
    'Build summary',
    ...results.map((result) =>
      result.status === 'built'
        ? `built ${result.runtime}`
        : `failed ${result.runtime}: ${errorMessage(result.error)}`,
    ),
  ].join('\n');
}

interface BuildViteBundleOptions {
  readonly root: string;
  readonly outDir: string;
  readonly bridgeEntry?: string | undefined;
  readonly logger: ReturnType<typeof createConsoleLogger>;
}

/**
 * Produces the production UI bundle the CLI hands to a runtime's `build` phase.
 * Registers {@link soundorBridgePlugin} so the app's `virtual:soundor/bridge`
 * resolves to the active runtime's browser bridge.
 */
async function buildViteBundle(options: BuildViteBundleOptions): Promise<void> {
  options.logger.info(`Building UI bundle -> ${options.outDir}`);
  await viteBuild({
    root: options.root,
    logLevel: 'warn',
    plugins: [soundorBridgePlugin({ entry: options.bridgeEntry })],
    build: {
      outDir: options.outDir,
      emptyOutDir: true,
    },
  });
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
  throw new ConfigError(
    'not-found',
    `Could not find ${CONFIG_FILENAME} in ${resolve(cwd)} or any parent directory.`,
  );
}
