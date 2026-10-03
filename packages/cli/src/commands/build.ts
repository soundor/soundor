import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { outro } from '@clack/prompts';
import {
  ConfigError,
  parseConfig,
  resolveRuntime,
  runPhase,
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

      await runPhase(resolved, 'build', config, {
        paths,
        fs,
        logger: logger.child(runtimeEntry.id),
        codegen: createCodegenSink(),
        mode: 'production',
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
