// A native engine, as a build that does not use the engine's CMake links it:
// the extracted archive's (or local stage's) soundor-engine.json, its
// "link" groups as absolute paths and linker flags. CMake consumers keep
// SoundorEnginePrebuilt.cmake, which reads the same metadata.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { EngineError } from './errors.ts';
import { readMetadata } from './prebuilt.ts';
import type { NativeTarget, NativeVariant } from './targets.ts';

export interface NativeLink {
  readonly directory: string;
  readonly includeDirs: string[];
  readonly libraries: string[];
  readonly linkFlags: string[];
  readonly hermesc: string;
}

/** Library groups, in link order; system libraries and frameworks follow. */
const LIBRARY_GROUPS = ['engine', 'hermes', 'skia', 'angle'];

export function nativeLink(
  directory: string,
  target: NativeTarget,
): NativeLink {
  const metadata = readMetadata(directory);
  const link = metadata.link ?? {};
  const unknown = Object.keys(link).filter(
    (group) =>
      !LIBRARY_GROUPS.includes(group) &&
      group !== 'system' &&
      group !== 'frameworks',
  );
  if (unknown.length)
    throw new EngineError(
      'artifact',
      `${directory} links ${unknown.join(', ')}, which this @soundor/engine does not know`,
    );
  const libraries = LIBRARY_GROUPS.flatMap((group) => link[group] ?? []).map(
    (file) => join(directory, file),
  );
  const missing = libraries.filter((file) => !existsSync(file));
  if (!libraries.length || missing.length)
    throw new EngineError(
      'artifact',
      `${directory} is incomplete: ${missing.length ? `${missing.join(', ')} missing` : 'it lists no libraries'}`,
    );
  const linkFlags = [
    ...(link['system'] ?? []).map((name) =>
      target === 'windows-x64'
        ? /\.lib$/i.test(name)
          ? name
          : `${name}.lib`
        : `-l${name}`,
    ),
    ...(link['frameworks'] ?? []).flatMap((name) => [
      '-framework',
      name.replace(/\.framework$/, ''),
    ]),
  ];
  const includeDirs = ['include', 'hermes/include', 'angle/include']
    .map((path) => join(directory, path))
    .filter((path) => existsSync(path));
  return {
    directory,
    includeDirs,
    libraries,
    linkFlags,
    hermesc: join(directory, metadata.hermes?.compiler ?? 'hermes/bin/hermesc'),
  };
}

/**
 * Builds and stages a native engine from the checkout's sources, with the
 * preset CI stages release archives with (`prebuilt-<variant>`: Skia, ANGLE
 * and Hermes from source, cached after the first time). A local build names
 * no source commit (zeros).
 */
export function buildNative(
  root: string,
  variant: NativeVariant,
  context: { env: NodeJS.ProcessEnv; log: (message: string) => void },
): string {
  const preset = `prebuilt-${variant}`;
  context.log(
    `building the ${variant} native engine (cmake --workflow --preset ${preset})`,
  );
  const result = spawnSync('cmake', ['--workflow', '--preset', preset], {
    cwd: root,
    env: {
      ...context.env,
      SOUNDOR_ENGINE_SOURCE_COMMIT:
        context.env['SOUNDOR_ENGINE_SOURCE_COMMIT'] || '0'.repeat(40),
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (result.error)
    throw new EngineError(
      'build',
      `Could not run cmake: ${result.error.message} (building the native engine needs CMake, Ninja or Visual Studio, and a C++20 compiler)`,
      { cause: result.error },
    );
  if (result.status !== 0)
    throw new EngineError(
      'build',
      `cmake --workflow --preset ${preset} failed (exit ${result.status ?? result.signal})`,
    );
  return join(root, 'build', preset, 'stage');
}
