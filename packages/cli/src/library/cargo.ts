/**
 * Cargo, as the CLI runs it for a runtime: `cargo rustc` on the project's
 * `lib/` crate, for the crate type and target the runtime asks for, in a
 * target directory of the project's own (`.soundor/cache/lib`), so that
 * neither rust-analyzer's `cargo check` nor `cargo test` in `lib/` waits
 * on the build's lock or invalidates its artifacts. Cargo compiles
 * incrementally: a build after a UI-only change does no work.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, watch, type FSWatcher } from 'node:fs';
import { join, resolve } from 'node:path';

import type {
  LibraryBuildRequest,
  LibraryBuildContext,
  LibraryArtifact,
} from '@soundor/config';
import {
  crateNotices,
  EnvError,
  RuntimeError,
  rustStdNotice,
  type Logger,
  type NoticeCollection,
  type ResolvedLicenses,
} from '@soundor/core';

/** The crate's manifest in a project, when it has one. */
export function libraryManifest(root: string): string | undefined {
  const manifest = resolve(root, 'lib', 'Cargo.toml');
  if (existsSync(resolve(root, 'native', 'Cargo.toml'))) {
    if (existsSync(manifest))
      throw new EnvError(
        'Both lib/Cargo.toml and native/Cargo.toml exist. Keep the Rust processor and controller library in lib/ and move or remove the obsolete native/ crate yourself. Soundor cannot choose between them; no files have been changed.',
      );
    throw new EnvError(
      'The Rust library directory has moved: rename native/ to lib/ (native/Cargo.toml → lib/Cargo.toml), then run soundor gen. Soundor will not rename or delete your files.',
    );
  }
  return existsSync(manifest) ? manifest : undefined;
}

/** What spawning Cargo takes; injectable for tests. */
export type SpawnCargo = (
  args: readonly string[],
  options: {
    cwd: string;
    signal?: AbortSignal;
    onStdout: (line: string) => void;
    onStderr: (text: string) => void;
  },
) => Promise<number | null>;

const spawnCargo: SpawnCargo = (args, { cwd, signal, onStdout, onStderr }) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn('cargo', [...args], { cwd, signal });
    let pending = '';
    child.stdout.on('data', (chunk: Buffer) => {
      pending += chunk.toString('utf8');
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) onStdout(line);
    });
    child.stderr.on('data', (chunk: Buffer) =>
      onStderr(chunk.toString('utf8')),
    );
    child.on('error', (error: NodeJS.ErrnoException) =>
      reject(
        error.code === 'ENOENT'
          ? new EnvError(
              'Cargo was not found. Install Rust (https://rustup.rs), then run `soundor doctor`.',
            )
          : error,
      ),
    );
    child.on('close', (code) => {
      if (pending.length > 0) onStdout(pending);
      resolvePromise(code);
    });
  });

let hostTriple: string | undefined;

/** The host's Rust target triple, from `rustc -vV`. */
export function rustHostTriple(): string {
  if (hostTriple !== undefined) return hostTriple;
  const result = spawnSync('rustc', ['-vV'], { encoding: 'utf8' });
  const host = /^host: (\S+)$/m.exec(result.stdout ?? '')?.[1];
  if (result.status !== 0 || host === undefined)
    throw new EnvError(
      'rustc was not found. Install Rust (https://rustup.rs), then run `soundor doctor`.',
    );
  hostTriple = host;
  return host;
}

export interface BuildLibraryOptions {
  readonly root: string;
  readonly manifest: string;
  readonly request: LibraryBuildRequest;
  readonly logger: Logger;
  readonly signal?: AbortSignal;
  readonly spawn?: SpawnCargo;
  readonly host?: () => string;
}

/** The arguments `cargo` is run with, and where its artifacts go. */
export function cargoArguments(
  root: string,
  manifest: string,
  request: LibraryBuildRequest,
  target: string,
): { args: string[]; targetDir: string } {
  const staticCrt = request.staticCrt === true && target.endsWith('-msvc');
  // A static C runtime is another set of flags, so another directory: else
  // each build would invalidate the other's.
  const targetDir = join(
    root,
    '.soundor',
    'cache',
    'lib',
    staticCrt ? 'target-crt-static' : 'target',
  );
  const args = [
    'rustc',
    '--manifest-path',
    manifest,
    '--lib',
    '--crate-type',
    request.crateType,
    '--target',
    target,
    '--target-dir',
    targetDir,
    '--message-format=json-render-diagnostics',
    ...(request.profile === 'release' ? ['--release'] : []),
    ...(staticCrt
      ? [
          '--config',
          `target.${target}.rustflags=["-C", "target-feature=+crt-static"]`,
        ]
      : []),
  ];
  return { args, targetDir };
}

/** Compiles the crate's library; resolves to its path. */
export async function buildLibrary(
  options: BuildLibraryOptions,
): Promise<LibraryArtifact> {
  const { request, logger } = options;
  const target = request.target ?? (options.host ?? rustHostTriple)();
  const { args } = cargoArguments(
    options.root,
    options.manifest,
    request,
    target,
  );
  const libraries: string[] = [];
  let packageId: string | undefined;
  const code = await (options.spawn ?? spawnCargo)(args, {
    cwd: options.root,
    signal: options.signal,
    onStdout: (line) => {
      if (!line.startsWith('{')) return;
      let message: {
        reason?: string;
        package_id?: string;
        manifest_path?: string;
        target?: { kind?: string[] };
        filenames?: string[];
      };
      try {
        message = JSON.parse(line) as typeof message;
      } catch {
        return;
      }
      if (
        message.reason === 'compiler-artifact' &&
        message.manifest_path !== undefined &&
        resolve(message.manifest_path) === resolve(options.manifest) &&
        message.target?.kind?.includes(request.crateType)
      ) {
        packageId = message.package_id;
        libraries.push(...(message.filenames ?? []));
      }
    },
    // Rendered diagnostics, and Cargo's progress.
    onStderr: (text) => {
      const trimmed = text.trimEnd();
      if (trimmed.length > 0) logger.pipe(trimmed, 'stderr');
    },
  });
  if (code !== 0)
    throw new RuntimeError(
      `The Rust library (${options.manifest}) failed to compile for ${target}; Cargo's errors are above.`,
    );
  const extension =
    request.crateType === 'cdylib' ? /\.(wasm|so|dylib|dll)$/ : /\.(a|lib)$/;
  const library = libraries.find((file) => extension.test(file));
  if (library === undefined)
    throw new RuntimeError(
      `Cargo built ${packageId ?? options.manifest} without a ${request.crateType} library.`,
    );
  return { path: library, target };
}

/**
 * Calls `listener` after the crate's sources or manifest change, at most once
 * per `delay` milliseconds. `target/` is ignored.
 */
export function watchLibrary(
  dir: string,
  listener: () => void,
  delay = 150,
): () => void {
  let timer: NodeJS.Timeout | undefined;
  const watchers: FSWatcher[] = [];
  const changed = (file?: string | null) => {
    if (file != null && /(^|[\\/])target([\\/]|$)/.test(file)) return;
    clearTimeout(timer);
    timer = setTimeout(listener, delay);
  };
  try {
    watchers.push(watch(dir, { recursive: true }, (_, file) => changed(file)));
  } catch {
    // Without recursive watching, the sources' directory and the manifest.
    for (const path of [join(dir, 'src'), dir])
      if (existsSync(path))
        watchers.push(watch(path, (_, file) => changed(file)));
  }
  return () => {
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  };
}

/**
 * The notices of what the crate's library links for `target`: its crates
 * (not itself) and Rust's standard library, from the project, whose
 * `rust-toolchain.toml` applies.
 */
export function libraryNotices(
  root: string,
  manifest: string,
  target: string,
  licenses?: ResolvedLicenses,
): NoticeCollection {
  const crates = crateNotices({
    manifest,
    target,
    cwd: root,
    ...(licenses === undefined ? {} : { licenses }),
  });
  const std = rustStdNotice({
    cwd: root,
    ...(licenses === undefined ? {} : { licenses }),
  });
  return {
    notices: [...crates.notices, ...std.notices],
    issues: [...crates.issues, ...std.issues],
    unused: [...crates.unused, ...std.unused],
  };
}

/** The `ctx.lib` the CLI gives runtimes, or undefined without a crate. */
export function libraryBuildContext(
  root: string,
  logger: Logger,
  signal?: AbortSignal,
  options: { watch?: boolean; spawn?: SpawnCargo } = {},
): LibraryBuildContext | undefined {
  const manifest = libraryManifest(root);
  if (manifest === undefined) return undefined;
  return {
    manifest,
    build: (request) =>
      buildLibrary({
        root,
        manifest,
        request,
        logger,
        ...(signal === undefined ? {} : { signal }),
        ...(options.spawn === undefined ? {} : { spawn: options.spawn }),
      }),
    notices: async (target, licenses) =>
      libraryNotices(root, manifest, target, licenses),
    ...(options.watch === true
      ? {
          onChange: (listener: () => void) =>
            watchLibrary(resolve(root, 'lib'), listener),
        }
      : {}),
  };
}
