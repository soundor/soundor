// Builds the VST3 runtime's prebuilt adapter, libsoundor_vst3.a, against the
// engine this package depends on (its engine() archive for the variant), and
// stages it where `soundor build vst3` looks for it:
//
//   prebuilt/linux-x64-<variant>/lib/libsoundor_vst3.a
//   prebuilt/linux-x64-<variant>/adapter.json      (what it was built against)
//   prebuilt/linux-x64-<variant>/licenses/vst3sdk/LICENSE.txt
//
//   node scripts/adapter.ts build [debug|release]   both variants by default
//   node scripts/adapter.ts test                    the native unit tests
//   node scripts/adapter.ts tidy                    clang-tidy
//
// The published package carries prebuilt/ (CI builds it on the Linux
// baseline before publishing); a workspace builds it with this.

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
): Promise<{ build: string; artifact: Awaited<ReturnType<typeof engine>> }> {
  if (process.platform !== 'linux' || process.arch !== 'x64')
    throw new Error('The VST3 runtime adapter builds on Linux x86_64 only.');
  const artifact = await engine({ target: 'linux-x64', variant });
  const build = join(native, 'build', preset === 'adapter' ? variant : preset);
  const args = [
    '-S',
    native,
    '-B',
    build,
    '-G',
    'Ninja',
    `-DCMAKE_BUILD_TYPE=${variant === 'debug' ? 'Debug' : 'Release'}`,
    `-DSOUNDOR_ENGINE_PREBUILT_${variant.toUpperCase()}_DIR=${artifact.directory}`,
    `-DSOUNDOR_VST3_RUNTIME_VERSION=${pkg.version}`,
    '-DSOUNDOR_WARNINGS_AS_ERRORS=ON',
    `-DSOUNDOR_VST3_TESTS=${preset === 'tests' ? 'ON' : 'OFF'}`,
    `-DSOUNDOR_ENABLE_CLANG_TIDY=${preset === 'tidy' ? 'ON' : 'OFF'}`,
    `-DSOUNDOR_NODE_EXE=${process.execPath}`,
  ];
  run('cmake', args);
  return { build, artifact };
}

async function build(variant: Variant): Promise<void> {
  const { build: directory, artifact } = await configure(variant, 'adapter');
  run('cmake', ['--build', directory, '--target', 'soundor_vst3']);
  const stage = join(root, 'prebuilt', `linux-x64-${variant}`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(join(stage, 'lib'), { recursive: true });
  cpSync(
    join(directory, 'lib', 'libsoundor_vst3.a'),
    join(stage, 'lib', 'libsoundor_vst3.a'),
  );
  cpSync(join(directory, 'licenses'), join(stage, 'licenses'), {
    recursive: true,
  });
  const metadata = JSON.parse(
    readFileSync(join(artifact.directory, 'soundor-engine.json'), 'utf8'),
  ) as {
    abiNamespace?: string;
  };
  writeFileSync(
    join(stage, 'adapter.json'),
    `${JSON.stringify(
      {
        format: 1,
        runtimeVersion: pkg.version,
        target: 'linux-x64',
        variant,
        vst3sdk: '3.8.1',
        engine: {
          version: artifact.version,
          sourceFingerprint: artifact.sourceFingerprint,
          abiNamespace: metadata.abiNamespace,
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
  const { build: directory } = await configure('debug', 'tests');
  run('cmake', ['--build', directory]);
  run('ctest', ['--test-dir', directory, '--output-on-failure']);
} else if (command === 'tidy') {
  const { build: directory } = await configure('debug', 'tidy');
  run('cmake', ['--build', directory, '--target', 'soundor_vst3']);
} else {
  throw new Error(`Unknown command ${command}: build, test or tidy`);
}
