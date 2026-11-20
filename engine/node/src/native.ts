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

/** How a build reports progress and reads its environment. */
interface BuildContext {
  env: NodeJS.ProcessEnv;
  log: (message: string) => void;
}

function cmake(args: string[], cwd: string, context: BuildContext): void {
  const result = spawnSync('cmake', args, {
    cwd,
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
      `Could not run cmake: ${result.error.message} (building the native engine needs CMake, Ninja (on Windows, Visual Studio), a C++20 compiler and Node)`,
      { cause: result.error },
    );
  if (result.status !== 0)
    throw new EngineError(
      'build',
      `cmake ${args.join(' ')} failed (exit ${result.status ?? result.signal})`,
    );
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
  context: BuildContext,
): string {
  const preset = `prebuilt-${variant}`;
  context.log(
    `building the ${variant} native engine (cmake --workflow --preset ${preset})`,
  );
  cmake(['--workflow', '--preset', preset], root, context);
  return join(root, 'build', preset, 'stage');
}

/**
 * Where an installed package's source build lives: in the Soundor cache, one
 * per engine version, target and variant (the sources of a version never
 * change).
 */
export function installedBuildDirectory(
  cache: string,
  version: string,
  target: NativeTarget,
  variant: NativeVariant,
): string {
  return join(cache, 'engine-source', version, `${target}-${variant}`);
}

/**
 * Builds and stages a native engine from an installed package's sources,
 * configured as the `prebuilt-<variant>` presets are (the package carries no
 * presets), into <directory>/build and <directory>/stage. A complete stage
 * is reused: the sources of an installed version never change.
 */
export function buildInstalledNative(
  root: string,
  target: NativeTarget,
  variant: NativeVariant,
  directory: string,
  context: BuildContext,
): string {
  const stage = join(directory, 'stage');
  if (existsSync(join(stage, 'soundor-engine.json'))) return stage;
  const build = join(directory, 'build');
  const debug = variant.startsWith('debug');
  const configuration = debug ? 'Debug' : 'Release';
  const windows = target === 'windows-x64';
  const generator =
    windows || context.env['CMAKE_GENERATOR'] ? [] : ['-G', 'Ninja'];
  context.log(
    `building the ${variant} native engine from this package's sources into ${directory} (Skia, ANGLE and Hermes included: minutes, once)`,
  );
  // Configured every time (seconds once configured): a configure that
  // failed halfway leaves a cache behind that a build alone would trust.
  cmake(
    [
      '-S',
      root,
      '-B',
      build,
      ...generator,
      `-DCMAKE_BUILD_TYPE=${configuration}`,
      '-DSOUNDOR_ENGINE_MODE=source',
      '-DSOUNDOR_BUILD_TESTS=OFF',
      `-DSOUNDOR_ENABLE_DEVTOOLS=${debug ? 'ON' : 'OFF'}`,
      `-DSOUNDOR_JS_SOURCE=${debug ? 'ON' : 'OFF'}`,
      `-DSOUNDOR_ENGINE_STAGE_DIR=${stage}`,
      // A local build names no source commit.
      `-DSOUNDOR_ENGINE_SOURCE_COMMIT=${context.env['SOUNDOR_ENGINE_SOURCE_COMMIT'] || '0'.repeat(40)}`,
      `-DSOUNDOR_NODE_EXE=${process.execPath}`,
      ...(variant.endsWith('-static')
        ? [`-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded${debug ? 'Debug' : ''}`]
        : []),
    ],
    root,
    context,
  );
  cmake(
    [
      '--build',
      build,
      '--config',
      configuration,
      '--target',
      'soundor_engine_stage',
    ],
    root,
    context,
  );
  return stage;
}
