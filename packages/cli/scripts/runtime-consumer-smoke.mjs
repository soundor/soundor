// Installs the packed Soundor packages and both runtimes the way a project
// does (strict, isolated pnpm; no peers installed automatically), then runs
// the installed CLI. Runtime host compatibility is declared through the
// soundor peer dependency and checked by the package manager.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const temporary = await mkdtemp(resolve(tmpdir(), 'soundor-runtime-consumer-'));

function run(command, args, { cwd = temporary, status = 0 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 300000,
    env: { ...process.env, NO_COLOR: '1' },
  });
  assert.equal(result.status, status, result.stdout + result.stderr);
  return result.stdout + result.stderr;
}

try {
  const tarballs = {};
  for (const folder of [
    'engines/engine',
    'engines/yoga-wasm',
    'packages/core',
    'packages/environment',
    'packages/config',
    'packages/expression',
    'packages/runtime-sdk',
    'packages/cli',
    'packages/devtools-protocol',
    'packages/devtools-server',
    'packages/devtools-client',
    'packages/driver',
    'runtimes/juce-runtime',
    'runtimes/web-runtime',
  ]) {
    const path = resolve(repository, folder);
    const manifest = JSON.parse(
      await readFile(resolve(path, 'package.json'), 'utf8'),
    );
    run('pnpm', ['pack', '--pack-destination', temporary], { cwd: path });
    tarballs[manifest.name] =
      'file:' +
      resolve(
        temporary,
        `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`,
      );
  }
  const project = {
    soundor: tarballs.soundor,
    '@soundor/config': tarballs['@soundor/config'],
    '@soundor/juce-runtime': tarballs['@soundor/juce-runtime'],
    '@soundor/web-runtime': tarballs['@soundor/web-runtime'],
  };
  await writeFile(
    resolve(temporary, 'package.json'),
    JSON.stringify({ private: true, type: 'module', dependencies: project }),
  );
  await writeFile(
    resolve(temporary, 'pnpm-workspace.yaml'),
    JSON.stringify({
      autoInstallPeers: false,
      strictPeerDependencies: true,
      nodeLinker: 'isolated',
      packageImportMethod: 'copy',
      overrides: tarballs,
      storeDir: dirname(
        run('pnpm', ['store', 'path'], { cwd: repository }).trim(),
      ),
    }),
  );
  run('pnpm', ['install', '--prefer-offline', '--ignore-scripts']);
  const soundor = resolve(temporary, 'node_modules/.bin/soundor');

  // The runtimes from their tarballs, through the installed CLI.
  await writeFile(
    resolve(temporary, 'soundor.config.ts'),
    `
import { defineSoundorConfig } from '@soundor/config';
import { juceRuntime } from '@soundor/juce-runtime';
import { webRuntime } from '@soundor/web-runtime';

export default defineSoundorConfig({
  plugin: { id: 'com.soundor.packed-runtimes', name: 'Packed runtimes' },
  parameters: { gain: { type: 'float32', label: 'Gain', min: 0, max: 1, default: 0.5 } },
  runtimes: [juceRuntime(), webRuntime()],
});
`,
  );
  run(soundor, ['gen']);
  // The project's config type checks with declarations (composite, as
  // create-soundor-app's tsconfig.node.json): its type names only
  // @soundor/config, not the runtimes' SDK, which the project does not have.
  await writeFile(
    resolve(temporary, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2023',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        skipLibCheck: true,
        composite: true,
        noEmit: true,
        types: [],
      },
      include: ['soundor.config.ts'],
    }),
  );
  run(resolve(repository, 'packages/cli/node_modules/.bin/tsc'), ['-p', '.']);
  assert.ok(
    existsSync(resolve(temporary, '.soundor/generated/parameters.d.ts')),
  );
  run(soundor, ['gen', '--check']);

  // The SDK is a regular dependency; the CLI is the runtime's host peer.
  for (const runtime of ['@soundor/juce-runtime', '@soundor/web-runtime']) {
    const manifest = JSON.parse(
      await readFile(
        resolve(temporary, 'node_modules', runtime, 'package.json'),
        'utf8',
      ),
    );
    assert.match(
      manifest.dependencies['@soundor/runtime-sdk'],
      /^\^0\.\d+\.\d+$/,
      runtime,
    );
    assert.equal(
      manifest.peerDependencies.soundor,
      manifest.dependencies['@soundor/runtime-sdk'],
      runtime,
    );
    for (const name of ['@soundor/config', '@soundor/core'])
      assert.equal(
        manifest.dependencies[name],
        undefined,
        `${runtime}: ${name}`,
      );
  }

  // An incompatible host peer fails a strict install before the CLI runs.
  const third = resolve(temporary, 'third-runtime');
  await mkdir(third);
  await writeFile(
    resolve(third, 'package.json'),
    JSON.stringify({
      name: 'soundor-runtime-third',
      version: '1.0.0',
      peerDependencies: { soundor: '^99.0.0' },
    }),
  );
  await writeFile(
    resolve(temporary, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: {
        ...project,
        'soundor-runtime-third': 'file:./third-runtime',
      },
    }),
  );
  const refused = run(
    'pnpm',
    ['install', '--prefer-offline', '--ignore-scripts'],
    { status: 1 },
  );
  assert.match(refused, /ERR_PNPM_PEER_DEP_ISSUES/);
  assert.match(refused, /soundor/);
  assert.match(refused, /99\.0\.0/);

  console.log(
    'Packed runtimes: strict pnpm install, gen with both runtimes, and an incompatible host peer refused by pnpm.',
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
