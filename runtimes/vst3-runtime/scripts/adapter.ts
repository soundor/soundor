// Builds the VST3 runtime's prebuilt adapter for this machine's target
// (linux-x64, macos-universal, windows-x64) against the engine this package
// depends on (its engine() archive for the variant; Windows: the static C
// runtime's), and stages it where `soundor build vst3` looks for it:
//
//   prebuilt/<target>-<variant>/lib/libsoundor_vst3.a   (Windows: soundor_vst3.lib)
//   prebuilt/<target>-<variant>/adapter.json      (what it was built against)
//   prebuilt/<target>-<variant>/licenses/vst3sdk/LICENSE.txt
//
//   node scripts/adapter.ts build [debug|release]   both variants by default
//   node scripts/adapter.ts test                    the native unit tests
//   node scripts/adapter.ts tidy                    clang-tidy
//
// A workspace builds its own with this; the published package carries none:
// CI builds each target's on its runner and releases them on GitHub
// (.github/scripts/vst3-adapters.mjs), and the package's
// artifacts/manifest.json names them (src/adapter.ts).
//
// Generators: Ninja on Linux and macOS; on Windows, CMake's default (Visual
// Studio's, which finds MSVC itself), or CMAKE_GENERATOR and
// CMAKE_GENERATOR_TOOLSET from the environment, as CI pins the toolset.

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { engine } from '@soundor/engine';

type Variant = 'debug' | 'release';

type Target = 'linux-x64' | 'macos-universal' | 'windows-x64';

function hostTarget(): Target {
  if (process.platform === 'linux' && process.arch === 'x64')
    return 'linux-x64';
  if (process.platform === 'darwin') return 'macos-universal';
  if (process.platform === 'win32' && process.arch === 'x64')
    return 'windows-x64';
  throw new Error(
    `The VST3 runtime's adapter builds on Linux x86_64, macOS and Windows x64, not ${process.platform} ${process.arch}.`,
  );
}

const target = hostTarget();
const windows = target === 'windows-x64';
const archive = windows ? 'soundor_vst3.lib' : 'libsoundor_vst3.a';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const native = join(root, 'native');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  version: string;
};

function run(cmd: string, args: string[], cwd = native): void {
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${cmd} ${args.join(' ')} failed (exit ${result.status ?? result.signal})`,
    );
}

async function configure(
  variant: Variant,
  preset: 'adapter' | 'tests' | 'tidy',
): Promise<{
  build: string;
  artifact: Awaited<ReturnType<typeof engine>>;
  config: string;
}> {
  const artifact = await engine({
    target,
    variant: windows ? `${variant}-static` : variant,
  });
  // macOS: the engine's minimum version, which plugins link for too.
  const minimumOs = (
    JSON.parse(
      readFileSync(join(artifact.directory, 'soundor-engine.json'), 'utf8'),
    ) as { target?: { minimumOsVersion?: string } }
  ).target?.minimumOsVersion;
  const build = join(native, 'build', preset === 'adapter' ? variant : preset);
  const config = variant === 'debug' ? 'Debug' : 'Release';
  const args = [
    '-S',
    native,
    '-B',
    build,
    ...(windows ? [] : ['-G', 'Ninja']),
    `-DCMAKE_BUILD_TYPE=${config}`,
    ...(windows
      ? [
          // The static C runtime, as the engine's -static archives.
          `-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded${variant === 'debug' ? 'Debug' : ''}`,
        ]
      : []),
    ...(target === 'macos-universal' && minimumOs !== undefined
      ? [`-DCMAKE_OSX_DEPLOYMENT_TARGET=${minimumOs}`]
      : []),
    `-DSOUNDOR_ENGINE_PREBUILT_${variant.toUpperCase()}_DIR=${artifact.directory}`,
    `-DSOUNDOR_VST3_RUNTIME_VERSION=${pkg.version}`,
    '-DSOUNDOR_WARNINGS_AS_ERRORS=ON',
    `-DSOUNDOR_VST3_TESTS=${preset === 'tests' ? 'ON' : 'OFF'}`,
    `-DSOUNDOR_ENABLE_CLANG_TIDY=${preset === 'tidy' ? 'ON' : 'OFF'}`,
    `-DSOUNDOR_NODE_EXE=${process.execPath}`,
  ];
  run('cmake', args);
  return { build, artifact, config };
}

async function build(variant: Variant): Promise<void> {
  const {
    build: directory,
    artifact,
    config,
  } = await configure(variant, 'adapter');
  run('cmake', [
    '--build',
    directory,
    '--config',
    config,
    '--target',
    'soundor_vst3',
  ]);
  const stage = join(root, 'prebuilt', `${target}-${variant}`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(join(stage, 'lib'), { recursive: true });
  cpSync(join(directory, 'lib', archive), join(stage, 'lib', archive));
  cpSync(join(directory, 'licenses'), join(stage, 'licenses'), {
    recursive: true,
  });
  const metadata = JSON.parse(
    readFileSync(join(artifact.directory, 'soundor-engine.json'), 'utf8'),
  ) as {
    engine?: { abiNamespace?: string };
  };
  writeFileSync(
    join(stage, 'adapter.json'),
    `${JSON.stringify(
      {
        format: 1,
        runtimeVersion: pkg.version,
        target,
        variant,
        vst3sdk: '3.8.1',
        engine: {
          version: artifact.version,
          sourceFingerprint: artifact.sourceFingerprint,
          abiNamespace: metadata.engine?.abiNamespace,
        },
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Staged the ${variant} adapter in ${stage}`);
}

const [command = 'build', ...rest] = process.argv.slice(2);
if (command === 'build') {
  const variants =
    rest.length > 0 ? (rest as Variant[]) : (['debug', 'release'] as const);
  for (const variant of variants) {
    if (variant !== 'debug' && variant !== 'release')
      throw new Error(`Unknown variant ${variant}`);
    await build(variant);
  }
} else if (command === 'test') {
  const { build: directory, config } = await configure('debug', 'tests');
  run('cmake', ['--build', directory, '--config', config]);
  run('ctest', [
    '--test-dir',
    directory,
    '--build-config',
    config,
    '--output-on-failure',
  ]);
} else if (command === 'tidy') {
  const { build: directory, config } = await configure('debug', 'tidy');
  run('cmake', [
    '--build',
    directory,
    '--config',
    config,
    '--target',
    'soundor_vst3',
  ]);
} else {
  throw new Error(`Unknown command ${command}: build, test or tidy`);
}
