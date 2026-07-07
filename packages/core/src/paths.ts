import { dirname, isAbsolute, resolve as resolvePath } from 'node:path';

/** Absolute, project-scoped paths handed to every lifecycle phase. */
export interface ProjectPaths {
  /** Project root (the directory containing `soundor.config.ts`). */
  readonly root: string;
  /** Absolute path to the config file. */
  readonly config: string;
  /** Build-output root for this runtime instance. */
  readonly dist: string;
  /** Generated-source output dir for this runtime (codegen target). */
  readonly gen: string;
  /** Scratch/cache dir the runtime may use freely. */
  readonly cache: string;
}

/** Inputs needed to derive a {@link ProjectPaths}. */
export interface CreateProjectPathsInput {
  /** Project root. */
  root: string;
  /** Path to the config file (absolute, or relative to `root`). */
  config: string;
  /** Runtime id; namespaces the per-runtime output dirs. */
  runtimeId: string;
}

/**
 * Derives the canonical {@link ProjectPaths} layout from a project root and the
 * runtime id: per-runtime output lives under `.soundor/<kind>/<id>`.
 */
export function createProjectPaths(
  input: CreateProjectPathsInput,
): ProjectPaths {
  const root = resolvePath(input.root);
  const config = isAbsolute(input.config)
    ? input.config
    : resolvePath(root, input.config);
  const base = resolvePath(root, '.soundor');
  return {
    root,
    config,
    dist: resolvePath(base, 'dist', input.runtimeId),
    gen: resolvePath(base, 'gen', input.runtimeId),
    cache: resolvePath(base, 'cache', input.runtimeId),
  };
}

/** Convenience: derive the project root as the directory holding the config. */
export function rootFromConfigPath(configPath: string): string {
  return dirname(resolvePath(configPath));
}
