// Installs the packed Soundor packages and both runtimes the way a project
// does (strict, isolated pnpm; no peers installed automatically), then runs
// the installed CLI. Runtime host compatibility is declared through the
// soundor peer dependency and checked by the package manager.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
    'engine',
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
    'hosts/vst3-host',
    'runtimes/vst3-runtime',
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
    '@soundor/vst3-host': tarballs['@soundor/vst3-host'],
    '@soundor/vst3-runtime': tarballs['@soundor/vst3-runtime'],
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
import { vst3Runtime } from '@soundor/vst3-runtime';
import { webRuntime } from '@soundor/web-runtime';

export default defineSoundorConfig({
  plugin: { id: 'com.soundor.packed-runtimes', name: 'Packed runtimes' },
  parameters: { gain: { type: 'float32', label: 'Gain', min: 0, max: 1, default: 0.5 } },
  runtimes: [vst3Runtime(), webRuntime()],
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

  // The Rust SDK comes in the packed CLI, its sources and not its fixture
  // contract, and Cargo builds and tests a scaffolded crate against it.
  const sdk = resolve(temporary, 'node_modules/soundor/rust/soundor');
  assert.ok(existsSync(resolve(sdk, 'Cargo.toml')));
  assert.ok(existsSync(resolve(sdk, 'src/lib.rs')));
  assert.ok(!existsSync(resolve(sdk, 'src/plugin.rs')));
  const help = run(soundor, ['--help']);
  assert.doesNotMatch(help, /\binit\b/);
  for (const phase of ['gen', 'dev', 'build', 'doctor'])
    assert.match(help, new RegExp(`\\b${phase}\\b`));
  for (const args of [['init'], ['init', 'web'], ['init', 'vst3']]) {
    assert.match(run(soundor, args, { status: 2 }), /Unknown command/i);
  }
  assert.ok(existsSync(resolve(temporary, 'lib/Cargo.toml')));
  assert.ok(existsSync(resolve(temporary, 'rust-toolchain.toml')));
  assert.ok(
    !existsSync(resolve(temporary, 'runtimes/web')),
    'web gen must not create a host',
  );
  assert.ok(
    !existsSync(resolve(temporary, 'runtimes/vst3')),
    'vst3 gen must not create a host',
  );
  // The VST3 runtime's crate, which Cargo compiles with the project's.
  const vst3Crate = resolve(
    temporary,
    'node_modules/@soundor/vst3-runtime/rust',
  );
  assert.ok(existsSync(resolve(vst3Crate, 'Cargo.toml')));
  assert.ok(existsSync(resolve(vst3Crate, 'src')));
  run('cargo', ['fmt', '--check', '--manifest-path', 'lib/Cargo.toml']);
  // Its tests: the controller, the processor, and allocation-free processing.
  const tested = run('cargo', ['test', '--manifest-path', 'lib/Cargo.toml']);
  assert.match(tested, /Running tests\/controller\.rs/);
  assert.match(tested, /Running tests\/processor\.rs/);
  assert.match(tested, /Running tests\/realtime\.rs/);
  assert.equal(tested.match(/test result: ok\. 1 passed/g)?.length, 3);
  // The same crate for the Web runtime: the processor and controller exports,
  // with the browser adapter's service and event-loop imports.
  run('cargo', [
    'rustc',
    '--manifest-path',
    'lib/Cargo.toml',
    '--lib',
    '--crate-type',
    'cdylib',
    '--release',
    '--target',
    'wasm32-unknown-unknown',
  ]);
  const release = resolve(
    temporary,
    'lib/target/wasm32-unknown-unknown/release',
  );
  const [module] = (await readdir(release)).filter((file) =>
    file.endsWith('.wasm'),
  );
  assert.ok(module, 'the crate built no WebAssembly module');
  const wasm = new WebAssembly.Module(await readFile(resolve(release, module)));
  assert.deepEqual(
    WebAssembly.Module.imports(wasm).sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    ['read_service_result', 'service', 'wake'].map((name) => ({
      module: 'soundor_controller',
      name,
      kind: 'function',
    })),
  );
  assert.ok(
    WebAssembly.Module.exports(wasm).some(
      (entry) => entry.name === 'soundor_wasm_contract',
    ),
  );
  const { exports } = new WebAssembly.Instance(wasm, {
    soundor_controller: {
      wake() {},
      service() {
        throw new Error('empty controller unexpectedly called a service');
      },
      read_service_result() {
        throw new Error('empty controller unexpectedly read a service result');
      },
    },
  });
  const controller = exports.soundor_web_controller_create();
  assert.ok(controller, 'the scaffold controller must initialize');
  exports.soundor_web_controller_destroy(controller);

  // The managed host from a packed package: a real Rust controller/processor,
  // a bundled UI, and browser TS/JS inputs outside the default web directory.
  await mkdir(resolve(temporary, 'src'));
  await mkdir(resolve(temporary, 'audio'));
  await writeFile(
    resolve(temporary, 'src/main.ts'),
    `
import { parameters } from 'soundor:parameters';
globalThis.__packedUi = parameters.gain.get();
`,
  );
  await writeFile(
    resolve(temporary, 'audio/label.ts'),
    'export const label: string = "Packed browser source";',
  );
  await writeFile(
    resolve(temporary, 'audio/inputs.ts'),
    `
import { defineInput, oscillator, audioFile, microphone } from '@soundor/web-runtime/input';
import { label } from './label';
// Browser code: config loading must not evaluate this module.
document.title = 'Packed browser input';
const custom = defineInput({ id: 'packed-custom', label, start({context, destination}) {
  const source = context.createOscillator(); source.connect(destination); source.start();
  return () => { source.stop(); source.disconnect(); };
}});
export default [custom, oscillator({ frequency: 330 }), audioFile(), microphone()];
`,
  );
  const configPath = resolve(temporary, 'soundor.config.ts');
  const originalConfig = await readFile(configPath, 'utf8');
  await writeFile(
    configPath,
    originalConfig.replace(
      'webRuntime()',
      "webRuntime({ inputs: './audio/inputs.ts' })",
    ),
  );
  // Custom inputs opt into a browser project, as the end-to-end suite's plugin does. Preserve the config project's types.
  const browserConfig = JSON.parse(
    await readFile(resolve(repository, 'tests/e2e/tsconfig.web.json'), 'utf8'),
  );
  browserConfig.include = ['audio/**/*.ts'];
  await writeFile(
    resolve(temporary, 'tsconfig.web.json'),
    JSON.stringify(browserConfig),
  );
  await writeFile(
    resolve(temporary, 'tsconfig.ui.json'),
    JSON.stringify({
      ...browserConfig,
      compilerOptions: {
        ...browserConfig.compilerOptions,
        lib: ['ES2023'],
        tsBuildInfoFile: './node_modules/.tmp/tsconfig.ui.tsbuildinfo',
      },
      include: ['typecheck-ui.ts'],
    }),
  );
  await writeFile(
    resolve(temporary, 'typecheck-ui.ts'),
    `
// @ts-expect-error shared UI must not gain DOM globals
void document;
// @ts-expect-error shared UI must not gain Web Audio globals
void AudioContext;
export {};
`,
  );
  await writeFile(
    resolve(temporary, 'tsconfig.node.json'),
    await readFile(resolve(temporary, 'tsconfig.json')),
  );
  await writeFile(
    resolve(temporary, 'tsconfig.json'),
    JSON.stringify({
      files: [],
      references: [
        { path: './tsconfig.node.json' },
        { path: './tsconfig.web.json' },
        { path: './tsconfig.ui.json' },
      ],
    }),
  );
  const tsc = resolve(repository, 'packages/cli/node_modules/.bin/tsc');
  run(tsc, ['-b']);
  await writeFile(
    resolve(temporary, 'audio/invalid.ts'),
    `
import { defineInput, oscillator } from '@soundor/web-runtime/input';
// @ts-expect-error the callback receives an AudioContext, not a string
const bad = defineInput({id: 'bad', label: 'Bad', start({context}) { const value: string = context; return () => {}; }});
// @ts-expect-error built-in options are checked
oscillator({ frequency: 'invalid' });
// @ts-expect-error DOM is present, and its types are checked
const broken: AudioContext = document;
void bad; void broken;
`,
  );
  run(tsc, ['-b']);
  const badPath = resolve(temporary, 'audio/invalid.ts');
  await writeFile(badPath, 'const bad: AudioContext = document; export {};');
  assert.match(run(tsc, ['-b'], { status: 1 }), /AudioContext/);
  await rm(badPath);
  run(tsc, ['-b']);

  // A source checkout may precede the first published web engine archive.
  // Prepare the workspace engine once, then use its supported CI override in
  // the installed consumer; the installed package must never try a source build.
  if (process.env.SOUNDOR_ENGINE_WASM === undefined) {
    const { engine } = await import(
      pathToFileURL(resolve(repository, 'engine/dist/index.mjs')).href
    );
    process.env.SOUNDOR_ENGINE_WASM = (
      await engine({ target: 'web' })
    ).files.wasm;
  }
  run(soundor, ['build', 'web']);
  const dist = resolve(temporary, '.soundor/dist/web');
  assert.ok(existsSync(resolve(dist, 'index.html')));
  assert.ok(!existsSync(resolve(temporary, 'runtimes/web')));
  const packageHost = resolve(
    temporary,
    'node_modules/@soundor/web-runtime/host/index.html',
  );
  assert.ok(existsSync(packageHost), 'packed host HTML is present');

  // Playwright is a repository test tool, never a dependency of the consumer.
  const require = createRequire(
    resolve(repository, 'runtimes/web-runtime/package.json'),
  );
  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch();
  const installed = createRequire(
    await realpath(
      resolve(temporary, 'node_modules/@soundor/web-runtime/package.json'),
    ),
  );
  const { preview } = await import(installed.resolve('vite'));
  const staticServer = await preview({
    root: temporary,
    configFile: false,
    build: { outDir: dist },
    preview: { port: 0 },
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(staticServer.resolvedUrls.local[0]);
    await page.waitForSelector('.soundor-title', { state: 'attached' });
    await page.waitForFunction(() => globalThis.__packedUi === 0.5);
    assert.equal(await page.evaluate(() => globalThis.__packedUi), 0.5);
    assert.equal(await page.title(), 'Packed browser input');
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await staticServer.close();
  }

  const child = spawn(soundor, ['dev', 'web'], {
    cwd: temporary,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => {
    logs += chunk;
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk;
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const waitFor = async (predicate) => {
    for (let i = 0; i < 600; i++) {
      if (predicate()) return;
      assert.equal(child.exitCode, null, logs);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Managed dev server did not become ready: ${logs}`);
  };
  try {
    await waitFor(() => /http:\/\/localhost:\d+/.test(logs));
    const url = /http:\/\/localhost:\d+/.exec(logs)[0];
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await page.waitForSelector('.soundor-title', { state: 'attached' });
    await page.waitForFunction(() => globalThis.__packedUi === 0.5);
    assert.equal(await page.evaluate(() => globalThis.__packedUi), 0.5);
    assert.equal(await page.title(), 'Packed browser input');
    await page
      .getByRole('button', { name: 'Host settings', exact: true })
      .click();
    const selector = page.getByRole('combobox', { name: 'Input', exact: true });
    assert.match(await selector.textContent(), /Packed browser source/);
    assert.match(await selector.textContent(), /Oscillator/);
    assert.match(await selector.textContent(), /Microphone/);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByText('Audio on', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await writeFile(
      resolve(temporary, 'audio/label.ts'),
      'export const label: string = "Updated packed source";',
    );
    await page
      .getByText('Updated packed source', { exact: true })
      .waitFor({ state: 'attached' });
    assert.deepEqual(errors, []);
    // Invalid module values and duplicates must fail visibly in the browser,
    // without starting a fallback list. Normal updates recover the host.
    for (const value of [
      '{}',
      'undefined',
      "[{ type: 'file' }, { type: 'file' }]",
    ]) {
      await writeFile(
        resolve(temporary, 'audio/inputs.ts'),
        `export default ${value};`,
      );
      await page.reload();
      await page
        .getByText(/The Soundor Web host could not start:.*(input|Input)/)
        .waitFor();
    }
  } finally {
    child.kill('SIGINT');
    await exited;
    await browser.close();
  }

  // The same installed project can select Web alone with default inputs;
  // no web initialization is introduced for either runtime selection.
  await writeFile(configPath, originalConfig.replace('vst3Runtime(), ', ''));
  run(soundor, ['gen']);
  run(soundor, ['build', 'web']);
  assert.ok(!existsSync(resolve(temporary, 'runtimes/web')));

  // The SDK is a regular dependency; the CLI is the runtime's host peer.
  for (const runtime of ['@soundor/vst3-runtime', '@soundor/web-runtime']) {
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
  // This fixture intentionally changes its manifest after the first install.
  // CI defaults to frozen lockfiles; resolve the new peer before checking it.
  const refused = run(
    'pnpm',
    ['install', '--no-frozen-lockfile', '--prefer-offline', '--ignore-scripts'],
    { status: 1 },
  );
  assert.match(refused, /ERR_PNPM_PEER_DEP_ISSUES/);
  assert.match(refused, /soundor/);
  assert.match(refused, /99\.0\.0/);

  console.log(
    'Packed runtimes: strict pnpm install, gen with both runtimes, the Rust SDK from the packed CLI tested with Cargo, managed Web build/dev and custom inputs in Chromium, separate browser types, and an incompatible host peer refused by pnpm.',
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
