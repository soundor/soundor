// Run after building dependencies: pnpm --filter @soundor/juce-runtime test:packed.
// Unpack the actual npm payload outside the workspace: no source-tree host fallback.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  createCodegenSink,
  createNodeFileSystem,
  resolveConfig,
} from '@soundor/runtime-sdk';

const packageDir = fileURLToPath(new URL('../', import.meta.url));
// Node resolves module paths through symlinks (macOS /var is /private/var).
const root = await realpath(
  await mkdtemp(join(tmpdir(), 'soundor-packed-juce-')),
);
try {
  const pnpm = process.env.npm_execpath;
  assert.ok(
    pnpm,
    'Run with pnpm exec node tests/packed.mjs or pnpm test:packed',
  );
  const script = /\.(?:c?js|mjs)$/.test(pnpm);
  execFileSync(
    script ? process.execPath : pnpm,
    [...(script ? [pnpm] : []), 'pack', '--out', join(root, 'runtime.tgz')],
    {
      cwd: packageDir,
      stdio: 'pipe',
    },
  );
  // Git for Windows' tar treats the colon in C:\... as a remote archive host.
  execFileSync('tar', ['-xzf', 'runtime.tgz'], { cwd: root });
  const installed = join(root, 'package');
  // Link each dependency's canonical directory. Linking node_modules itself
  // relocates pnpm's relative links across drives on Windows (D: checkout, C: temp).
  const manifest = JSON.parse(
    await readFile(join(installed, 'package.json'), 'utf8'),
  );
  for (const name of Object.keys(manifest.dependencies)) {
    const target = join(installed, 'node_modules', name);
    await mkdir(join(target, '..'), { recursive: true });
    await symlink(
      await realpath(join(packageDir, 'node_modules', name)),
      target,
      'junction',
    );
  }
  const runtime = await import(
    pathToFileURL(join(installed, 'dist/index.mjs')).href
  );
  assert.equal(runtime.NATIVE_DIR, join(installed, 'native'));
  for (const path of [
    'plugin/CMakeLists.txt',
    'plugin/Plugin.cpp',
    'SoundorRust.cmake',
    'SoundorPluginBundle.cmake',
    'backend/juce/VST3.exports',
  ]) {
    assert.ok(
      (await readFile(join(runtime.NATIVE_DIR, path), 'utf8')).length > 0,
      path,
    );
  }

  const project = join(root, 'consumer with spaces');
  await mkdir(join(project, 'JUCE/modules'), { recursive: true });
  await writeFile(join(project, 'JUCE/CMakeLists.txt'), '# fixture');
  const config = resolveConfig({
    plugin: { id: 'dev.soundor.packed', name: 'Packed Plugin' },
    runtimes: [runtime.juceRuntime()],
  });
  const controller = new AbortController();
  controller.abort();
  const logger = {
    info() {},
    warn() {},
    error() {},
    debug() {},
    pipe() {},
    child() {
      return this;
    },
  };
  const ctx = {
    phase: 'build',
    mode: 'production',
    options: {
      jucePath: join(project, 'JUCE'),
      formats: ['vst3'],
      dev: { launch: false },
    },
    runtimeConfig: { id: 'juce', options: {} },
    fs: createNodeFileSystem(project),
    paths: {
      root: project,
      config: join(project, 'soundor.config.ts'),
      gen: join(project, '.soundor/generated/runtimes/juce'),
      cache: join(project, '.soundor/cache/juce'),
      dist: join(project, '.soundor/dist/juce'),
      state: join(project, '.soundor/state/juce'),
    },
    codegen: createCodegenSink(),
    logger,
    signal: controller.signal,
    signing: { macos: { identity: '-', source: 'default' } },
    lib: {
      manifest: join(project, 'lib/Cargo.toml'),
      async build(request) {
        requests.push(request);
        return {
          path: join(project, 'libplugin.a'),
          target: 'x86_64-unknown-linux-gnu',
        };
      },
    },
  };
  const requests = [];
  assert.equal(await ctx.fs.exists(join(project, 'runtimes')), false);
  await runtime.juceGen(config, ctx);
  const files = new Map(
    ctx.codegen.files().map((file) => [file.path, file.contents]),
  );
  const setup = files.get('setup.cmake');
  assert.ok(
    setup.includes(
      join(installed, 'native/SoundorRust.cmake').replaceAll('\\', '/'),
    ),
  );
  assert.ok(files.has('soundor/native/SoundorNative.cpp'));
  assert.ok(
    setup.includes('add_subdirectory(') && setup.includes('soundor-engine'),
  );
  const calls = [];
  const deps = {
    platform: 'linux',
    probe: () => ({ ok: true, version: '1.2.3' }),
    loadHost: async () => undefined,
    run: async (command) => {
      calls.push(command);
    },
  };
  await runtime.juceBuild(config, ctx, deps);
  await runtime.juceBuild(config, { ...ctx, mode: 'debug' }, deps);
  await runtime.juceDev(config, { ...ctx, mode: 'debug' }, deps);
  assert.deepEqual(
    requests.map((request) => request.profile),
    ['release', 'debug', 'debug'],
  );
  for (const command of calls.filter((command) => command.args[0] === '-S')) {
    assert.equal(command.args[1], join(installed, 'native/plugin'));
    assert.ok(
      command.args.includes(
        `-DSOUNDOR_GENERATED_DIR=${ctx.paths.gen.replaceAll('\\', '/')}`,
      ),
    );
    assert.ok(command.args.includes('-DSOUNDOR_ENGINE_MODE=prebuilt'));
    assert.ok(
      command.args.includes(
        `-DSOUNDOR_RUST_LIBRARY=${join(project, 'libplugin.a').replaceAll('\\', '/')}`,
      ),
    );
  }
  assert.equal(await ctx.fs.exists(join(project, 'runtimes')), false);
  console.log(
    'Packed JUCE consumer: generation, release, debug and dev paths passed.',
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
