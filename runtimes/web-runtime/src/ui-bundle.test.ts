import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { createServer as viteCreateServer, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { webBuild, webDev, webGen, webInit } from './index';
import {
  makeCtx,
  PNG,
  PNG_ID,
  SOURCE_CLIENT_DIR,
  tempProject,
  testConfig,
  writeGenerated,
  writeUiBundle,
} from './testing';

/** A plugin UI bundle that uses the runtime's modules, as the CLI emits it. */
const BUNDLE = `import { parameters } from 'soundor:parameters';
import { snapshot } from 'soundor:host';
const logo = ${JSON.stringify(PNG_ID)};
globalThis.__fixtureUi = { gain: parameters.gain.get(), host: snapshot().hostName, logo, marker: 'FIXTURE_UI_MARKER' };
`;

async function project(): Promise<string> {
  const root = await tempProject();
  const ctx = makeCtx(root);
  await webInit(testConfig, ctx);
  await webGen(testConfig, ctx);
  await writeGenerated(ctx);
  // The scaffold's config imports the built package, which tests run without.
  await writeFile(
    join(root, 'runtimes/web/vite.config.ts'),
    'export default {};\n',
  );
  return root;
}

async function distFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(dir, join(entry.parentPath, entry.name)).split('\\').join('/'),
    )
    .sort();
}

describe('the UI bundle in a production build', () => {
  it('includes the bundle, with soundor:* resolved, and its assets', async () => {
    const root = await project();
    const ui = await writeUiBundle(
      join(root, '.soundor/ui/production'),
      BUNDLE,
    );
    const ctx = makeCtx(root, { mode: 'production', ui });

    await webBuild(testConfig, ctx, { clientDir: SOURCE_CLIENT_DIR });

    const files = await distFiles(ctx.paths.dist);
    expect(files).toContain(`soundor-assets/${PNG_ID}`);
    expect(
      await readFile(join(ctx.paths.dist, 'soundor-assets', PNG_ID)),
    ).toEqual(PNG);

    const scripts = files.filter((file) => file.endsWith('.js'));
    const code = (
      await Promise.all(
        scripts.map((file) => readFile(join(ctx.paths.dist, file), 'utf8')),
      )
    ).join('\n');
    expect(code).toContain('FIXTURE_UI_MARKER');
    expect(code).not.toContain('soundor:parameters');
    expect(code).not.toContain('soundor:host');
    for (const file of files) {
      const text = await readFile(join(ctx.paths.dist, file), 'utf8');
      expect({ file, leaks: text.includes(root) }).toEqual({
        file,
        leaks: false,
      });
    }
  });

  it('builds a host with an empty viewport for a project without UI', async () => {
    const root = await project();
    const ctx = makeCtx(root, { mode: 'production' });
    await webBuild(testConfig, ctx, { clientDir: SOURCE_CLIENT_DIR });

    const files = await distFiles(ctx.paths.dist);
    expect(files.some((file) => file.startsWith('soundor-assets/'))).toBe(
      false,
    );
    const code = (
      await Promise.all(
        files
          .filter((file) => file.endsWith('.js'))
          .map((file) => readFile(join(ctx.paths.dist, file), 'utf8')),
      )
    ).join('\n');
    expect(code).toContain('This plugin has no UI.');
    expect(ctx.logger.lines).toContainEqual({
      level: 'warn',
      message: expect.stringContaining('no UI entry'),
    });
  });

  it('never bundles the project UI sources itself', async () => {
    const root = await project();
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(
      join(root, 'src/main.tsx'),
      "console.log('ROOT_SOURCE_MARKER');\n",
    );
    const ctx = makeCtx(root, { mode: 'production' });
    await webBuild(testConfig, ctx, { clientDir: SOURCE_CLIENT_DIR });

    for (const file of await distFiles(ctx.paths.dist)) {
      const text = await readFile(join(ctx.paths.dist, file), 'utf8');
      expect({ file, bundled: text.includes('ROOT_SOURCE_MARKER') }).toEqual({
        file,
        bundled: false,
      });
    }
  });
});

describe('the UI bundle in soundor dev', () => {
  const stops: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const stop of stops.splice(0)) await stop();
  });

  /** Runs webDev on a project with a live UI; returns the real server. */
  async function serve() {
    const root = await project();
    const ui = await writeUiBundle(
      join(root, '.soundor/ui/development'),
      BUNDLE,
    );
    const logFile = join(root, '.soundor/dev/ui.log');
    await mkdir(join(root, '.soundor/dev'), { recursive: true });
    await writeFile(logFile, '');
    const controller = new AbortController();
    const ctx = makeCtx(root, {
      options: { port: 0 },
      signal: controller.signal,
      ui: { ...ui, live: { logFile } },
    });
    let server: ViteDevServer | undefined;
    const running = webDev(testConfig, ctx, {
      clientDir: SOURCE_CLIENT_DIR,
      createServer: async (config) => {
        server = await viteCreateServer(config);
        return server;
      },
    });
    stops.push(async () => {
      controller.abort();
      await running;
    });
    await vi.waitFor(
      () => expect(server?.resolvedUrls?.local[0]).toBeDefined(),
      {
        timeout: 10_000,
      },
    );
    const url = server!.resolvedUrls!.local[0]!;
    return { root, ui, logFile, server: server!, url };
  }

  it('serves the bundle with soundor:* resolved to the host modules', async () => {
    const { ui, url } = await serve();
    const virtual = await (
      await fetch(new URL('@id/__x00__soundor:internal/ui', url))
    ).text();
    expect(virtual).toContain('export const hasUi = true');
    const match = /import\("([^"]+bundle\.js[^"]*)"\)/.exec(virtual);
    expect(match).not.toBeNull();
    expect(match![1]).toContain('/@fs/');
    expect(match![1]).toContain(ui.dir.split('\\').join('/'));

    const bundle = await (await fetch(new URL(match![1]!, url))).text();
    expect(bundle).toContain('FIXTURE_UI_MARKER');
    expect(bundle).toMatch(/from "[^"]*modules\/parameters\.ts"/);
    expect(bundle).toMatch(/from "[^"]*modules\/host\.ts"/);
  });

  it('serves the bundle assets next to the page', async () => {
    const { url } = await serve();
    const response = await fetch(new URL(`soundor-assets/${PNG_ID}`, url));
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
    const missing = await fetch(
      new URL('soundor-assets/ffffffffffffffff.png', url),
    );
    expect(missing.headers.get('content-type')).not.toBe('image/png');
  });

  it('reloads on a new build-id only, keeping the page through failed builds', async () => {
    const { ui, server, url } = await serve();
    const send = vi.spyOn(server.ws, 'send');
    const reloads = () =>
      send.mock.calls.filter(
        ([payload]) =>
          (payload as { type?: string } | undefined)?.type === 'full-reload',
      ).length;

    // A build in progress, or one that failed: the bundle changes, the id not.
    await writeFile(join(ui.dir, 'bundle.js'), `${BUNDLE}\n// half written`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(reloads()).toBe(0);

    await writeFile(
      join(ui.dir, 'bundle.js'),
      BUNDLE.replace('FIXTURE_UI_MARKER', 'REBUILT_MARKER'),
    );
    await writeFile(join(ui.dir, 'build-id'), 'build-2');
    await vi.waitFor(() => expect(reloads()).toBe(1), { timeout: 5000 });

    const virtual = await (
      await fetch(new URL('@id/__x00__soundor:internal/ui', url))
    ).text();
    const path = /import\("([^"]+)"\)/.exec(virtual)![1]!;
    expect(await (await fetch(new URL(path, url))).text()).toContain(
      'REBUILT_MARKER',
    );
  });

  it("appends the page's console to the CLI's UI log", async () => {
    const { logFile, url } = await serve();
    const socket = new WebSocket(url.replace(/^http/, 'ws'), 'vite-hmr');
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve);
      socket.addEventListener('error', reject);
    });
    socket.send(
      JSON.stringify({
        type: 'custom',
        event: 'soundor:log',
        data: { level: 'warn', message: 'hello' },
      }),
    );
    socket.send(
      JSON.stringify({
        type: 'custom',
        event: 'soundor:log',
        data: { level: 'nope', message: 1 },
      }),
    );
    await vi.waitFor(
      async () => {
        expect(await readFile(logFile, 'utf8')).toBe(
          `${JSON.stringify({ level: 'warn', source: 'Soundor Basic', message: 'hello' })}\n`,
        );
      },
      { timeout: 5000 },
    );
    socket.close();
  });
});
