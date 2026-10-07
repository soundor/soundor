/**
 * Runtime resolution and lifecycle dispatch — the seam the CLI uses to drive a
 * runtime without ever importing a concrete one. {@link resolveRuntime} maps an
 * id to the live implementation carried in `config.runtimes[]`; {@link runPhase}
 * assembles the {@link LifecycleContext} and invokes a single phase.
 */

import {
  RuntimeError,
  SoundorError,
  UnknownRuntimeError,
  type CodegenSink,
  type FileSystemHost,
  type Logger,
  type ProjectPaths,
} from '@soundor/core';

import type { LifecycleContext, RuntimeMode, RuntimePhase } from './context';
import type { DoctorReport, Runtime } from './runtime';
import { resolveSigning } from './signing';
import type { RuntimeConfig, SoundorConfig } from './types';

/** A runtime implementation paired with the config entry that selected it. */
export interface ResolvedRuntime {
  runtime: Runtime;
  config: RuntimeConfig;
}

/**
 * Finds the runtime registered under `id` in `config.runtimes[]`. Throws
 * {@link UnknownRuntimeError} (listing the available ids) when none matches.
 */
export function resolveRuntime(
  config: SoundorConfig,
  id: string,
): ResolvedRuntime {
  const entry = config.runtimes.find((runtime) => runtime.id === id);
  if (entry === undefined) {
    throw new UnknownRuntimeError(
      id,
      config.runtimes.map((runtime) => runtime.id),
    );
  }
  return {
    runtime: entry.runtime,
    config: { id: entry.id, options: entry.options },
  };
}

/** Host-supplied pieces the dispatcher assembles into a {@link LifecycleContext}. */
export interface DispatchContextInput {
  paths: ProjectPaths;
  logger: Logger;
  fs: FileSystemHost;
  codegen: CodegenSink;
  ui?: LifecycleContext['ui'];
  /** Defaults to `'debug'`; the build command passes `'production'`. */
  mode?: RuntimeMode;
  signal?: AbortSignal;
  /** The environment signing is resolved against; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Dispatches one lifecycle phase: builds the {@link LifecycleContext} from the
 * host input and the resolved config entry, then invokes the matching method.
 * Errors already in the Soundor taxonomy pass through; anything else is wrapped
 * as a {@link RuntimeError} tagged with the runtime id and phase.
 */
export async function runPhase(
  resolved: ResolvedRuntime,
  phase: RuntimePhase,
  config: SoundorConfig,
  input: DispatchContextInput,
): Promise<void | DoctorReport> {
  const ctx: LifecycleContext = {
    phase,
    mode: input.mode ?? 'debug',
    runtimeConfig: resolved.config,
    options: resolved.config.options ?? {},
    paths: input.paths,
    logger: input.logger,
    fs: input.fs,
    codegen: input.codegen,
    ui: input.ui,
    signing: resolveSigning(config, input.env),
    signal: input.signal ?? new AbortController().signal,
  };

  const { runtime } = resolved;
  try {
    switch (phase) {
      case 'init':
        return await runtime.init(config, ctx);
      case 'gen':
        return await runtime.gen(config, ctx);
      case 'dev':
        return await runtime.dev(config, ctx);
      case 'build':
        return await runtime.build(config, ctx);
      case 'doctor':
        return await runtime.doctor(config, ctx);
    }
  } catch (error) {
    if (error instanceof SoundorError) throw error;
    throw new RuntimeError(
      `Runtime '${runtime.id}' failed during '${phase}'.`,
      { runtimeId: runtime.id, phase, cause: error },
    );
  }
}
