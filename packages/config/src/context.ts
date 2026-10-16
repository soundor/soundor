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

import type { SigningContext } from './signing';
import type { RuntimeConfig } from './types';

/** Build/run mode. */
export type RuntimeMode = 'debug' | 'production';

/** The five lifecycle phases every runtime implements. */
export type RuntimePhase = 'init' | 'gen' | 'dev' | 'build' | 'doctor';

/** Credentials for one development session. Never log or embed in artifacts. */
export interface DevToolsConnection {
  readonly endpoint: string;
  readonly sessionId: string;
  readonly token: string;
  /** Protected descriptor for launchers; pass its path, never credentials, to processes. */
  readonly descriptorPath?: string;
}

/**
 * The plugin UI bundle the CLI built before dispatching `dev` or `build`: a
 * directory holding `entry` (the JavaScript bundle) and its assets. The CLI
 * owns the bundler; runtimes ship or serve the files.
 */
export interface UiBundleContext {
  /** Absolute path to the bundle directory. */
  readonly dir: string;
  /**
   * The bundle file inside `dir`, `bundle.js`, in Soundor's native runtime's
   * module form: a CommonJS module function, lowered for Hermes (see
   * `toNativeModule()` in @soundor/core).
   */
  readonly entry: string;
  /**
   * The same bundle as one ES module (ES2023) inside `dir`, `bundle.mjs`: for
   * runtimes that load ES modules, such as the Web.
   */
  readonly module: string;
  /**
   * Set by `soundor dev`: the CLI keeps rebuilding `dir` in place and rewrites
   * `dir/build-id` last after every successful build. A runtime should load
   * the UI from `dir` (not embed it) and reload it when `build-id` changes.
   */
  readonly live?: LiveUiContext;
}

/** Development-only details of a {@link UiBundleContext}. */
export interface LiveUiContext {
  /**
   * The file the plugin appends its UI log to, one JSON object per line
   * (`{"level","source","message"}`); the CLI shows it in the terminal.
   */
  readonly logFile: string;
}

/**
 * Set by `soundor dev`: how a long-lived `dev` phase talks to the terminal
 * the developer is watching.
 */
export interface DevSessionContext {
  /**
   * Reports that the runtime is up (and again after anything it rebuilds):
   * the CLI prints its summary, with `rows` after its own.
   */
  ready(rows?: readonly DevSummaryRow[]): void;
  /** Adds a terminal shortcut, run by typing `key` and enter. */
  shortcut(shortcut: DevShortcut): void;
}

/** One line of the summary `soundor dev` prints, such as a URL to open. */
export interface DevSummaryRow {
  readonly label: string;
  readonly value: string;
}

/** A terminal shortcut a runtime adds to `soundor dev`. */
export interface DevShortcut {
  /** What the developer types before enter: one or a few characters. */
  readonly key: string;
  readonly description: string;
  action(): void | Promise<void>;
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
  /** Only provided for supported runtimes in the debug development phase. */
  readonly devtools?: DevToolsConnection;
  /** Only provided in `dev`, by a host that shows the session in a terminal. */
  readonly session?: DevSessionContext;
  /**
   * The resolved code signing (environment, then `config.signing`, then
   * ad-hoc). A runtime that produces macOS binaries signs every one of them
   * with `signing.macos`, as the last step of its build.
   */
  readonly signing: SigningContext;
  /** Aborts long-running phases (notably `dev`). */
  readonly signal: AbortSignal;
}
