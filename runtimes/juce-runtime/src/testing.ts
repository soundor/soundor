/**
 * Internal test support: an in-memory {@link FileSystemHost} and a
 * {@link LifecycleContext} builder. Pure (no test framework imports); not an
 * entry point, so it is tree-shaken out of the published bundles.
 */

import { isAbsolute, resolve as resolvePath } from 'node:path';

import {
  createCodegenSink,
  type CollectingCodegenSink,
  type FileSystemHost,
  type LifecycleContext,
  type Logger,
} from '@soundor/runtime-sdk';

import type { JuceOptions } from './options';

/** A {@link FileSystemHost} backed by two in-memory sets. */
export interface MemoryFs extends FileSystemHost {
  readonly contents: Map<string, string>;
  readonly existing: Set<string>;
}

/**
 * Creates an in-memory filesystem rooted at `root`. `seedFiles` keys are file
 * paths (their ancestor dirs are marked existing); `seedDirs` are extra dirs to
 * mark existing (e.g. a JUCE `modules/` folder).
 */
export function memoryFs(
  root = '/proj',
  seedFiles: Record<string, string> = {},
  seedDirs: readonly string[] = [],
): MemoryFs {
  const contents = new Map<string, string>();
  const existing = new Set<string>();
  const abs = (path: string): string =>
    isAbsolute(path) ? path : resolvePath(root, path);

  const markAncestors = (target: string): void => {
    let dir = resolvePath(target, '..');
    for (;;) {
      existing.add(dir);
      const parent = resolvePath(dir, '..');
      if (parent === dir) break;
      dir = parent;
    }
  };

  const write = (path: string, value: string): void => {
    const target = abs(path);
    contents.set(target, value);
    existing.add(target);
    markAncestors(target);
  };

  for (const [path, value] of Object.entries(seedFiles)) write(path, value);
  for (const dir of seedDirs) existing.add(abs(dir));

  return {
    contents,
    existing,
    resolve: (...segments) => resolvePath(root, ...segments),
    exists: (path) => Promise.resolve(existing.has(abs(path))),
    read: (path) => {
      const value = contents.get(abs(path));
      if (value === undefined)
        return Promise.reject(new Error(`ENOENT: ${path}`));
      return Promise.resolve(value);
    },
    write: (path, value) => {
      write(path, value);
      return Promise.resolve();
    },
    mkdir: (path) => {
      existing.add(abs(path));
      return Promise.resolve();
    },
    rm: (path) => {
      contents.delete(abs(path));
      existing.delete(abs(path));
      return Promise.resolve();
    },
    readdir: (path) => {
      const base = abs(path);
      const prefix = `${base}/`;
      const names = new Set<string>();
      for (const key of [...contents.keys(), ...existing]) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          const name = rest.split('/')[0];
          if (name) names.add(name);
        }
      }
      return Promise.resolve([...names]);
    },
  };
}

/** A logger that records nothing but satisfies the interface. */
export function silentLogger(): Logger {
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    pipe: () => {},
    child: () => logger,
  };
  return logger;
}

export interface MakeCtxOptions {
  readonly root?: string;
  readonly fs?: FileSystemHost;
  readonly options?: JuceOptions;
  readonly mode?: 'debug' | 'production';
  readonly dev?: LifecycleContext['dev'];
  readonly build?: LifecycleContext['build'];
  readonly signal?: AbortSignal;
}

export interface TestCtx extends LifecycleContext<JuceOptions> {
  readonly codegen: CollectingCodegenSink;
}

/** Builds a {@link LifecycleContext} for exercising phases in isolation. */
export function makeCtx(overrides: MakeCtxOptions = {}): TestCtx {
  const root = overrides.root ?? '/proj';
  const fs = overrides.fs ?? memoryFs(root);
  return {
    phase: 'gen',
    mode: overrides.mode ?? 'debug',
    runtimeConfig: { id: 'juce', options: overrides.options ?? {} },
    options: overrides.options ?? {},
    paths: {
      root,
      config: `${root}/soundor.config.ts`,
      dist: `${root}/.soundor/dist/juce`,
      gen: `${root}/.soundor/generated/runtimes/juce`,
      cache: `${root}/.soundor/cache/juce`,
    },
    logger: silentLogger(),
    fs,
    codegen: createCodegenSink(),
    dev: overrides.dev,
    build: overrides.build,
    signal: overrides.signal ?? new AbortController().signal,
  };
}
