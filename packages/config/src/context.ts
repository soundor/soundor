/**
 * The typed context handed to every runtime lifecycle method alongside the
 * config. It bundles the project paths, structured logger, filesystem access,
 * and codegen sink — the seams a runtime executes against, whose concrete
 * implementations live in `@soundor/core`.
 */

import type {
  CodegenSink,
  FileSystemHost,
  Logger,
  ProjectPaths,
} from '@soundor/core';

import type { RuntimeConfig } from './types';

/** Build/run mode. */
export type RuntimeMode = 'debug' | 'production';

/** The five lifecycle phases every runtime implements. */
export type RuntimePhase = 'init' | 'gen' | 'dev' | 'build' | 'doctor';

/**
 * The plugin UI bundle the CLI built before dispatching `dev` or `build`: a
 * directory holding `entry` (the JavaScript bundle) and its assets. The CLI
 * owns the bundler; runtimes ship or serve the files.
 */
export interface UiBundleContext {
  /** Absolute path to the bundle directory. */
  readonly dir: string;
  /** The bundle file inside `dir`, e.g. `bundle.js`. */
  readonly entry: string;
}

/**
 * Context passed to every lifecycle method. Generic over the runtime's opaque
 * options bag so a runtime reads its own `options` with full types.
 */
export interface LifecycleContext<Options extends object = object> {
  /** Phase currently executing (enables generic dispatch and logging). */
  readonly phase: RuntimePhase;
  /** Mode: `'debug'` by default; `'production'` for a release build. */
  readonly mode: RuntimeMode;
  /** The declarative config entry that selected this runtime. */
  readonly runtimeConfig: RuntimeConfig;
  /** Typed view of `runtimeConfig.options` (the runtime-owned bag). */
  readonly options: Options;
  readonly paths: ProjectPaths;
  readonly logger: Logger;
  readonly fs: FileSystemHost;
  readonly codegen: CodegenSink;
  /** The plugin UI bundle, for `dev` and `build` of projects with a UI. */
  readonly ui?: UiBundleContext;
  /** Aborts long-running phases (notably `dev`). */
  readonly signal: AbortSignal;
}
