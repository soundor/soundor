// Installs the packed Soundor packages and both runtimes the way a project
// does (strict, isolated pnpm; no peers installed automatically), then runs
// the installed CLI: each package must resolve what it imports from its own
// manifest, the runtimes must depend on one release line of the SDK (their
// runtime API version is that of their copy), and a runtime of a newer
// runtime API is refused before anything is generated.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  parameters: [{ type: 'float', id: 'gain', label: 'Gain', min: 0, max: 1, default: 0.5 }],
  runtimes: [juceRuntime(), webRuntime()],
});
`,
  );
  run(soundor, ['gen']);
  assert.ok(
    existsSync(resolve(temporary, '.soundor/generated/parameters.d.ts')),
  );
  run(soundor, ['gen', '--check']);

  // A runtime's API version is that of its own SDK copy: one release line of
  // it, so that sharing the CLI's copy (deduplicated) cannot change it.
  for (const runtime of ['@soundor/juce-runtime', '@soundor/web-runtime']) {
    const manifest = JSON.parse(
      await readFile(
        resolve(temporary, 'node_modules', runtime, 'package.json'),
        'utf8',
      ),
    );
    for (const name of ['@soundor/runtime-sdk', '@soundor/config'])
      assert.match(
        manifest.dependencies[name],
        /^\^0\.\d+\.\d+$/,
        `${runtime}: ${name}`,
      );
  }

  // A runtime of a newer runtime API: refused, exit code 4, nothing written.
  await rm(resolve(temporary, '.soundor'), { recursive: true, force: true });
  await writeFile(
    resolve(temporary, 'soundor.config.ts'),
    `
import { defineSoundorConfig } from '@soundor/config';
import { webRuntime } from '@soundor/web-runtime';

const noop = async () => {};
const newer = {
  id: 'newer',
  apiVersion: 999,
  init: noop, gen: noop, dev: noop, build: noop,
  doctor: async () => ({ checks: [] }),
};

export default defineSoundorConfig({
  plugin: { id: 'com.soundor.packed-runtimes', name: 'Packed runtimes' },
  parameters: [],
  runtimes: [webRuntime(), { id: 'newer', options: {}, runtime: newer }],
});
`,
  );
  const refused = run(soundor, ['gen'], { status: 4 });
  assert.match(
    refused,
    /Runtime 'newer' implements runtime API 999, newer than this soundor/,
  );
  assert.ok(!existsSync(resolve(temporary, '.soundor')));

  console.log(
    'Packed runtimes: strict pnpm install, gen with both runtimes, and an incompatible runtime refused.',
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
