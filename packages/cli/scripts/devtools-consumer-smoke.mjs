import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const temporary = await mkdtemp(
  resolve(tmpdir(), 'soundor-devtools-consumer-'),
);
function run(command, args, cwd = temporary, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}
try {
  const tarballs = {};
  for (const folder of [
    'runtimes/engine',
    'packages/core',
    'packages/config',
    'packages/cli',
    'packages/devtools-protocol',
    'packages/devtools-server',
    'packages/devtools-client',
  ]) {
    const path = resolve(repository, folder);
    const manifest = JSON.parse(
      await readFile(resolve(path, 'package.json'), 'utf8'),
    );
    run('pnpm', ['pack', '--pack-destination', temporary], path);
    tarballs[manifest.name] =
      'file:' +
      resolve(
        temporary,
        manifest.name.replace('@', '').replace('/', '-') +
          '-' +
          manifest.version +
          '.tgz',
      );
  }
  await writeFile(
    resolve(temporary, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: tarballs,
    }),
  );
  await writeFile(
    resolve(temporary, 'pnpm-workspace.yaml'),
    JSON.stringify({
      autoInstallPeers: false,
      strictPeerDependencies: true,
      nodeLinker: 'isolated',
      packageImportMethod: 'copy',
      overrides: tarballs,
      storeDir: dirname(run('pnpm', ['store', 'path'], repository).trim()),
    }),
  );
  run('pnpm', ['install', '--prefer-offline', '--ignore-scripts']);
  // Resolve the browser application relative to the installed bundled CLI.
  await writeFile(
    resolve(temporary, 'smoke.mjs'),
    `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { startDevToolsServer } from '@soundor/devtools-server';
import { startSimulatedRuntime } from '@soundor/devtools-server/testing';
const require = createRequire(import.meta.url);
const cliRequire = createRequire(require.resolve('soundor/package.json'));
const staticDir = join(dirname(cliRequire.resolve('@soundor/devtools-client/package.json')), 'dist');
const server = await startDevToolsServer({ projectRoot: process.cwd(), staticDir });
const runtime = await startSimulatedRuntime({ connection: server.connection });
try {
  const response = await fetch(server.connection.endpoint);
  assert.equal(response.status, 200);
  const html = await response.text();
  const asset = html.match(/src="([^"]+\\.js)"/)[1];
  const script = await fetch(server.connection.endpoint + asset);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);
} finally { await runtime.close(); await server.close(); }
`,
  );
  run('node', ['smoke.mjs']);
  await mkdir(resolve(temporary, 'settings/soundor'), { recursive: true });
  await writeFile(
    resolve(temporary, 'settings/soundor/config.json'),
    '{"devtools":{"open":false}}',
  );
  // Exercise actual bundled CLI asset resolution through a plugin-free runtime.
  await writeFile(
    resolve(temporary, 'soundor.config.ts'),
    `
import { defineSoundorConfig } from '@soundor/config';
export default defineSoundorConfig({
  plugin: { id: 'com.soundor.packed-test', name: 'Packed test' }, parameters: [],
  runtimes: [{ id: 'smoke', options: {}, runtime: {
    id: 'smoke', capabilities: { devtools: { inspector: true } },
    async init() {}, async gen() {}, async build() {}, async doctor() { return { checks: [] }; },
    async dev(_config, ctx) {
      if (!ctx.devtools) throw new Error('DevTools startup failed');
      const response = await fetch(ctx.devtools.endpoint);
      const html = await response.text();
      if (!html.includes('Soundor DevTools')) throw new Error('Client assets missing');
      const asset = html.match(/src="([^"]+\\.js)"/)[1];
      if (!(await fetch(ctx.devtools.endpoint + asset)).ok) throw new Error('Chunk missing');
      ctx.logger.info('PACKED_DEVTOOLS_OK');
    },
  } }],
});
`,
  );
  const output = run('pnpm', ['exec', 'soundor', 'dev', 'smoke'], temporary, {
    ...process.env,
    XDG_CONFIG_HOME: resolve(temporary, 'settings'),
  });
  assert.match(output, /PACKED_DEVTOOLS_OK/);
  console.log(
    'Packed DevTools server, testing export, client assets, and bundled CLI passed.',
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
