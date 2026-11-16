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
export type RuntimePhase = 'gen' | 'dev' | 'build' | 'doctor';

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
 * directory holding `module` (the JavaScript bundle, one ES module) and its
 * assets. The CLI owns the bundler; runtimes ship or serve the files, or
 * turn them into the form they run (as the JUCE runtime does for its
 * engine).
 */
export interface UiBundleContext {
  /** Absolute path to the bundle directory. */
  readonly dir: string;
  /**
   * The bundle as one ES module (ES2023) inside `dir`, `bundle.mjs`, with
   * `soundor:*` imports left as imports. In development, `<module>.map` next
   * to it maps it to the original sources.
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
  /**
   * Calls `listener` after every later successful build, once `build-id` is
   * written (the first build is done before the phase starts). Returns a
   * function that stops calling it.
   */
  onBuild(listener: () => void): () => void;
  /**
   * Has the CLI map `<file>:line:column` locations in the plugin's log
   * (stack frames, such as `/bundle.js:12:5`) through the source map at
   * `mapFile`. The map is read now: call again after rewriting it.
   */
  sourceMap(file: string, mapFile: string): Promise<void>;
}

/**
 * The project's Rust crate, `native/`, which holds the plugin's audio
 * processing: the CLI compiles it with Cargo, for each runtime's target,
 * before or while the runtime links or loads it. Runtimes never run Cargo
 * themselves.
 */
export interface NativeCrateContext {
  /** Absolute path to the crate's manifest, `native/Cargo.toml`. */
  readonly manifest: string;
  /**
   * Compiles the crate's library (incrementally: unchanged sources build in
   * a moment) and resolves to it. Rejects with the compiler's diagnostics,
   * which it has already logged.
   */
  build(request: NativeBuildRequest): Promise<NativeLibrary>;
  /**
   * Set by `soundor dev`: calls `listener` after the crate's sources change
   * (debounced), so that the runtime can build it again. Returns a function
   * that stops calling it.
   */
  readonly onChange?: (listener: () => void) => () => void;
}

/** What {@link NativeCrateContext.build} compiles. */
export interface NativeBuildRequest {
  /**
   * `staticlib`, linked into a native plugin, or `cdylib`, a WebAssembly
   * module.
   */
  readonly crateType: 'staticlib' | 'cdylib';
  /** The Rust target triple; the host's by default. */
  readonly target?: string;
  /** Cargo's `dev` profile, or `release`. */
  readonly profile: 'debug' | 'release';
  /**
   * Windows: link the C runtime statically (`+crt-static`), as a plugin built
   * for MSVC's `/MT` must.
   */
  readonly staticCrt?: boolean;
}

/** A compiled library of the crate. */
export interface NativeLibrary {
  /** Absolute path to the library (`.a`, `.lib` or `.wasm`). */
  readonly path: string;
  /** The Rust target triple it was compiled for. */
  readonly target: string;
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
  /**
   * The project's Rust crate (`native/`), for `dev` and `build`; undefined
   * when the project has none.
   */
  readonly native?: NativeCrateContext;
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
