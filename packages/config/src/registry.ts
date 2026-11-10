/**
 * Runtime resolution and lifecycle dispatch — the seam the CLI uses to drive a
 * runtime without ever importing a concrete one. {@link resolveRuntime} maps an
 * id to the live implementation carried in `config.runtimes[]`; {@link runPhase}
 * assembles the {@link LifecycleContext} and invokes a single phase.
 */

import {
  RuntimeError,
  UnknownRuntimeError,
  isSoundorError,
  type CodegenSink,
  type FileSystemHost,
  type Logger,
  type ProjectPaths,
} from '@soundor/core';

import { checkRuntimeCompatibility } from './compatibility';
import type { LifecycleContext, RuntimeMode, RuntimePhase } from './context';
import type { DoctorReport, Runtime } from './runtime';
import { resolveSigning } from './signing';
import type { ResolvedSoundorConfig, RuntimeConfig } from './types';

/** A runtime implementation paired with the config entry that selected it. */
export interface ResolvedRuntime {
  runtime: Runtime;
  config: RuntimeConfig;
  /** The runtime API version it implements, which the host runs. */
  apiVersion: number;
}

/**
 * Finds the runtime registered under `id` in `config.runtimes[]` and checks
 * that this host runs its runtime API version, and that it has what the config
 * uses (`checkRuntimeCompatibility`). Throws {@link
 * UnknownRuntimeError} (listing the available ids) when none matches, and a
 * `RuntimeCompatibilityError` when it does not support the host: entry points
 * resolve every runtime they will run before generating anything.
 */
export function resolveRuntime(
  config: ResolvedSoundorConfig,
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
    apiVersion: checkRuntimeCompatibility(entry.runtime, config),
  };
}

/** Host-supplied pieces the dispatcher assembles into a {@link LifecycleContext}. */
export interface DispatchContextInput {
  paths: ProjectPaths;
  logger: Logger;
  fs: FileSystemHost;
  codegen: CodegenSink;
  ui?: LifecycleContext['ui'];
  devtools?: LifecycleContext['devtools'];
  session?: LifecycleContext['session'];
  /** Defaults to `'debug'`; the build command passes `'production'`. */
  mode?: RuntimeMode;
  signal?: AbortSignal;
  /** The environment signing is resolved against; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Dispatches one lifecycle phase: builds the {@link LifecycleContext} from the
 * host input and the resolved config entry, then invokes the matching method.
 * Soundor errors pass through, whichever copy of `@soundor/core` the runtime
 * threw them from (`isSoundorError`); anything else is wrapped as a {@link
 * RuntimeError} tagged with the runtime id and phase.
 */
export async function runPhase(
  resolved: ResolvedRuntime,
  phase: RuntimePhase,
  config: ResolvedSoundorConfig,
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
    devtools:
      phase === 'dev' &&
      (input.mode ?? 'debug') === 'debug' &&
      resolved.runtime.capabilities?.devtools !== undefined
        ? input.devtools
        : undefined,
    session: phase === 'dev' ? input.session : undefined,
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
    if (isSoundorError(error)) throw error;
    throw new RuntimeError(
      `Runtime '${runtime.id}' failed during '${phase}'.`,
      { runtimeId: runtime.id, phase, cause: error },
    );
  }
}
