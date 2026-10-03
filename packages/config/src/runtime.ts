/**
 * The runtime contract.
 *
 * A runtime owns execution and the build graph; this defines only the seams the
 * core orchestrates. Every runtime implements the same five-phase {@link
 * Runtime} lifecycle so the CLI can dispatch generically, never special-casing
 * one. A config author registers a runtime by passing a live {@link
 * RuntimeDescriptor} into `runtimes[]` — the object returned by a runtime's
 * factory (built with `defineRuntime` in `@soundor/runtime-sdk`).
 */

import type { LifecycleContext } from './context';
import type { SoundorConfig } from './types';

/** Result of a single environment/toolchain check performed by `doctor`. */
export interface DoctorCheck {
  label: string;
  status: 'ok' | 'warn' | 'fail';
  /** Why the check landed on this status (the reason). */
  detail?: string;
  /** A concrete, actionable fix — surfaced for `warn`/`fail` checks. */
  suggestion?: string;
}

/** Diagnostic report returned by {@link Runtime.doctor}. */
export interface DoctorReport {
  checks: DoctorCheck[];
}

/**
 * The full lifecycle every runtime implements. All five methods share one shape
 * — `(config, ctx)` — so orchestration can dispatch by phase alone.
 */
export interface Runtime<Options extends object = object> {
  /** Stable id; must match the `id` used in `config.runtimes[]`. */
  readonly id: string;
  /** Scaffold/prepare a project for this runtime. */
  init(config: SoundorConfig, ctx: LifecycleContext<Options>): Promise<void>;
  /** Produce generated sources via `ctx.codegen`. */
  gen(config: SoundorConfig, ctx: LifecycleContext<Options>): Promise<void>;
  /** Run the long-lived dev workflow until `ctx.signal` aborts. */
  dev(config: SoundorConfig, ctx: LifecycleContext<Options>): Promise<void>;
  /** Produce production artifacts under `ctx.paths.dist`. */
  build(config: SoundorConfig, ctx: LifecycleContext<Options>): Promise<void>;
  /** Diagnose environment/toolchain readiness. */
  doctor(
    config: SoundorConfig,
    ctx: LifecycleContext<Options>,
  ): Promise<DoctorReport>;
}

/**
 * A live, typed entry for `config.runtimes[]`. It carries the declarative
 * `{ id, options }` (assignable to {@link RuntimeConfig}) plus the concrete
 * {@link Runtime} implementation the CLI dispatches. This is what a runtime
 * factory (e.g. `juceRuntime({ ... })`) returns.
 */
export interface RuntimeDescriptor<Options extends object = object> {
  readonly id: string;
  readonly options: Options;
  readonly runtime: Runtime<Options>;
}

/**
 * The config-callable factory a runtime package exports (e.g. `juceRuntime`).
 * Calling it yields a {@link RuntimeDescriptor} to drop into `runtimes[]`.
 */
export interface RuntimeFactory<Options extends object = object> {
  (options?: Options): RuntimeDescriptor<Options>;
  readonly id: string;
  readonly runtime: Runtime<Options>;
}
