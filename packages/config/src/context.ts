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

/** UI development server details supplied by the CLI during `dev`. */
export interface DevUiContext {
  readonly kind: 'vite';
  readonly url: string;
}

/** Long-lived development services available to runtime `dev` phases. */
export interface DevContext {
  readonly ui?: DevUiContext;
}

/**
 * Location of the production UI bundle the CLI built during `build`. The CLI
 * owns the UI bundler (Vite) — a runtime consumes the emitted assets rather
 * than invoking a bundler itself, mirroring how {@link DevUiContext} hands over
 * the dev-server URL.
 */
export interface BuildUiContext {
  readonly kind: 'vite';
  /** Absolute path to the directory holding the built UI assets. */
  readonly dir: string;
}

/** Build-time assets the CLI produced before dispatching a runtime `build`. */
export interface BuildContext {
  readonly ui?: BuildUiContext;
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
  /** Development-only services started by the CLI before runtime dispatch. */
  readonly dev?: DevContext;
  /** Production UI assets the CLI built before dispatching `build`. */
  readonly build?: BuildContext;
  /** Aborts long-running phases (notably `dev`). */
  readonly signal: AbortSignal;
}
