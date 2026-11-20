/**
 * Building the VST3 adapter from its sources (`native/`, which the package
 * carries) with CMake, against an engine directory as engine() prepares one:
 * what `build:native` stages in the workspace (`scripts/adapter.ts`), and
 * what source mode (`vst3Runtime({ engine: { mode: 'source' } })`) builds for
 * a plugin, into the Soundor cache.
 *
 * Generators: Ninja on Linux and macOS; on Windows, CMake's default (Visual
 * Studio's, which finds MSVC itself), or CMAKE_GENERATOR and
 * CMAKE_GENERATOR_TOOLSET from the environment, as CI pins the toolset.
 *
 * Imports carry their extension: `scripts/adapter.ts` runs this with Node.
 */

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  adapterArchiveName,
  type Variant,
  type Vst3Target,
} from './targets.ts';

/** The engine an adapter is compiled against: engine()'s artifact. */
export interface AdapterEngine {
  readonly directory: string;
  readonly version: string;
  readonly sourceFingerprint: string | undefined;
}

/**
 * What a build directory is for: the adapter alone (`adapter`, what is
 * staged and what source mode builds), or Soundor's checks of it, each with
 * the native unit tests: `dev` (Debug, -Werror), `sanitize` (ASan + UBSan)
 * and `tidy` (clang-tidy over the adapter and its tests).
 */
export type AdapterPreset = 'adapter' | 'dev' | 'sanitize' | 'tidy';

export interface AdapterBuild {
  readonly packageRoot: string;
  readonly target: Vst3Target;
  readonly variant: Variant;
  readonly engine: AdapterEngine;
  /** The CMake build directory. */
  readonly build: string;
  readonly preset?: AdapterPreset;
  /** Warnings fail the build (Soundor's own builds; not a user's). */
  readonly warningsAsErrors?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  /** Where CMake's output goes: inherited (a terminal) or a log line each. */
  readonly stdio?: 'inherit' | 'ignore';
}

function packageVersion(packageRoot: string): string {
  return (
    JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      version: string;
    }
  ).version;
}

function run(
  args: string[],
  options: Pick<AdapterBuild, 'env' | 'stdio'> & { cwd: string },
): void {
  const result = spawnSync('cmake', args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ['ignore', options.stdio ?? 'inherit', 'inherit'],
  });
  if (result.error)
    throw new Error(
      `Could not run cmake: ${result.error.message} (building the VST3 adapter needs CMake, Ninja (on Windows, Visual Studio) and a C++20 compiler)`,
      { cause: result.error },
    );
  if (result.status !== 0)
    throw new Error(
      `cmake ${args.join(' ')} failed (exit ${result.status ?? result.signal})`,
    );
}

/** The CMake configuration (Debug or Release) of a variant. */
export function configurationOf(variant: Variant): 'Debug' | 'Release' {
  return variant === 'debug' ? 'Debug' : 'Release';
}

/** Configures the adapter's build directory against <engine>. */
export function configureAdapter(options: AdapterBuild): void {
  const { packageRoot, target, variant, engine } = options;
  const preset = options.preset ?? 'adapter';
  const windows = target === 'windows-x64';
  const env = options.env ?? process.env;
  // macOS: the engine's minimum version, which plugins link for too.
  const minimumOs = (
    JSON.parse(
      readFileSync(join(engine.directory, 'soundor-engine.json'), 'utf8'),
    ) as { target?: { minimumOsVersion?: string } }
  ).target?.minimumOsVersion;
  const native = join(packageRoot, 'native');
  run(
    [
      '-S',
      native,
      '-B',
      options.build,
      ...(windows || env['CMAKE_GENERATOR'] ? [] : ['-G', 'Ninja']),
      `-DCMAKE_BUILD_TYPE=${configurationOf(variant)}`,
      // Windows: the static C runtime, as the engine's -static archives.
      ...(windows
        ? [
            `-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded${variant === 'debug' ? 'Debug' : ''}`,
          ]
        : []),
      ...(target === 'macos-universal' && minimumOs !== undefined
        ? [`-DCMAKE_OSX_DEPLOYMENT_TARGET=${minimumOs}`]
        : []),
      `-DSOUNDOR_ENGINE_PREBUILT_${variant.toUpperCase()}_DIR=${engine.directory}`,
      `-DSOUNDOR_VST3_RUNTIME_VERSION=${packageVersion(packageRoot)}`,
      `-DSOUNDOR_WARNINGS_AS_ERRORS=${options.warningsAsErrors ? 'ON' : 'OFF'}`,
      `-DSOUNDOR_VST3_TESTS=${preset === 'adapter' ? 'OFF' : 'ON'}`,
      `-DSOUNDOR_ENABLE_SANITIZERS=${preset === 'sanitize' ? 'ON' : 'OFF'}`,
      `-DSOUNDOR_ENABLE_CLANG_TIDY=${preset === 'tidy' ? 'ON' : 'OFF'}`,
      `-DSOUNDOR_NODE_EXE=${process.execPath}`,
    ],
    { ...options, cwd: native },
  );
}

/** Builds <targets> (default: the adapter's archive; none: everything) in a configured directory. */
export function buildTargets(
  options: AdapterBuild,
  targets: readonly string[] = ['soundor_vst3'],
): void {
  run(
    [
      '--build',
      options.build,
      '--config',
      configurationOf(options.variant),
      ...targets.flatMap((target) => ['--target', target]),
    ],
    { ...options, cwd: join(options.packageRoot, 'native') },
  );
}

/**
 * Configures, builds and stages the adapter into <stage>, as `soundor build
 * vst3` finds it (configured every time: seconds once configured, and the
 * engine directory may have changed):
 *
 *   <stage>/lib/libsoundor_vst3.a   (Windows: soundor_vst3.lib)
 *   <stage>/adapter.json            (what it was built against)
 *   <stage>/licenses/vst3sdk/LICENSE.txt
 */
export function buildAdapter(options: AdapterBuild, stage: string): void {
  configureAdapter(options);
  buildTargets(options);
  const archive = adapterArchiveName(options.target);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(join(stage, 'lib'), { recursive: true });
  cpSync(join(options.build, 'lib', archive), join(stage, 'lib', archive));
  cpSync(join(options.build, 'licenses'), join(stage, 'licenses'), {
    recursive: true,
  });
  const metadata = JSON.parse(
    readFileSync(join(options.engine.directory, 'soundor-engine.json'), 'utf8'),
  ) as { engine?: { abiNamespace?: string } };
  writeFileSync(
    join(stage, 'adapter.json'),
    `${JSON.stringify(
      {
        format: 1,
        runtimeVersion: packageVersion(options.packageRoot),
        target: options.target,
        variant: options.variant,
        vst3sdk: '3.8.1',
        engine: {
          version: options.engine.version,
          sourceFingerprint: options.engine.sourceFingerprint,
          abiNamespace: metadata.engine?.abiNamespace,
        },
      },
      null,
      2,
    )}\n`,
  );
}
