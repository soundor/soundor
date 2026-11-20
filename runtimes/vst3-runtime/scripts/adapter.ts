// Builds the VST3 runtime's prebuilt adapter for this machine's target
// (linux-x64, macos-universal, windows-x64) against the engine this package
// depends on (its engine() archive for the variant; Windows: the static C
// runtime's), and stages it where `soundor build vst3` looks for it in the
// workspace (src/source.ts builds it):
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
// artifacts/manifest.json names them (src/adapter.ts). Source mode builds
// one for a plugin instead, the same way (src/source.ts).

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { engine } from '@soundor/engine';

import {
  type AdapterBuild,
  type AdapterPreset,
  buildAdapter,
  buildTargets,
  configurationOf,
  configureAdapter,
} from '../src/source.ts';
import { engineVariant, requireTarget, type Variant } from '../src/targets.ts';

const target = requireTarget(process.platform, process.arch);
const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function prepare(
  variant: Variant,
  preset: AdapterPreset,
): Promise<AdapterBuild> {
  const artifact = await engine({
    target,
    variant: engineVariant(target, variant),
  });
  return {
    packageRoot: root,
    target,
    variant,
    engine: artifact,
    build: join(
      root,
      'native',
      'build',
      preset === 'adapter' ? variant : preset,
    ),
    preset,
    warningsAsErrors: true,
  };
}

const [command = 'build', ...rest] = process.argv.slice(2);
if (command === 'build') {
  const variants =
    rest.length > 0 ? (rest as Variant[]) : (['debug', 'release'] as const);
  for (const variant of variants) {
    if (variant !== 'debug' && variant !== 'release')
      throw new Error(`Unknown variant ${variant}`);
    const options = await prepare(variant, 'adapter');
    const stage = join(root, 'prebuilt', `${target}-${variant}`);
    buildAdapter(options, stage);
    console.log(`Staged the ${variant} adapter in ${stage}`);
  }
} else if (command === 'test') {
  const options = await prepare('debug', 'tests');
  configureAdapter(options);
  buildTargets(options, []); // everything, tests included
  const result = spawnSync(
    'ctest',
    [
      '--test-dir',
      options.build,
      '--build-config',
      configurationOf('debug'),
      '--output-on-failure',
    ],
    { stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`ctest failed (exit ${result.status ?? result.signal})`);
} else if (command === 'tidy') {
  const options = await prepare('debug', 'tidy');
  configureAdapter(options);
  buildTargets(options);
} else {
  throw new Error(`Unknown command ${command}: build, test or tidy`);
}
