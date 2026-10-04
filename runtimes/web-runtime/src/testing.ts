/**
 * Internal test support: temporary projects and a {@link LifecycleContext}
 * builder. Pure (no test framework imports); not an entry point, so it is
 * tree-shaken out of the published bundles.
 */

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createCodegenSink,
  createNodeFileSystem,
  createProjectPaths,
  writeGeneratedFiles,
  type CollectingCodegenSink,
  type LifecycleContext,
  type Logger,
  type SoundorConfig,
} from '@soundor/runtime-sdk';

import type { WebOptions } from './options';

/** The package's browser sources, which Vite serves directly in tests. */
export const SOURCE_CLIENT_DIR = fileURLToPath(
  new URL('./client/', import.meta.url),
);

export const testConfig = {
  plugin: { id: 'com.example.basic', name: 'Soundor Basic' },
  runtimes: [],
  parameters: [
    { type: 'float', id: 'gain', label: 'Gain', min: 0, max: 1, default: 0.5 },
  ],
} as unknown as SoundorConfig;

/** A logger that records what it is given. */
export interface RecordingLogger extends Logger {
  readonly lines: { level: string; message: string }[];
}

export function recordingLogger(): RecordingLogger {
  const lines: { level: string; message: string }[] = [];
  const record =
    (level: string) =>
    (message: string): void => {
      lines.push({ level, message });
    };
  const logger: RecordingLogger = {
    lines,
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    pipe: () => {},
    child: () => logger,
  };
  return logger;
}

export interface MakeCtxOptions {
  readonly options?: WebOptions;
  readonly mode?: 'debug' | 'production';
  readonly signal?: AbortSignal;
  readonly ui?: LifecycleContext['ui'];
}

export interface TestCtx extends LifecycleContext<WebOptions> {
  readonly codegen: CollectingCodegenSink;
  readonly logger: RecordingLogger;
}

/** A context for a project at `root`, on the real filesystem. */
export function makeCtx(root: string, overrides: MakeCtxOptions = {}): TestCtx {
  return {
    phase: 'gen',
    mode: overrides.mode ?? 'debug',
    runtimeConfig: { id: 'web', options: overrides.options ?? {} },
    options: overrides.options ?? {},
    paths: createProjectPaths({
      root,
      config: 'soundor.config.ts',
      runtimeId: 'web',
    }),
    logger: recordingLogger(),
    fs: createNodeFileSystem(root),
    codegen: createCodegenSink(),
    ui: overrides.ui,
    signal: overrides.signal ?? new AbortController().signal,
  };
}

/** A new, empty project directory. */
export function tempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'web-runtime-'));
}

/** Writes what a context's codegen collected, as `soundor gen` would. */
export async function writeGenerated(ctx: TestCtx): Promise<void> {
  await writeGeneratedFiles(ctx.fs, ctx.paths.gen, ctx.codegen.files());
}
