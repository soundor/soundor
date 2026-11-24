import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import {
  checkGeneratedFiles,
  resolveConfig,
  GeneratedFilesOutOfDateError,
  type DevShortcut,
  type DevSummaryRow,
  type ResolvedSoundorConfig,
} from '@soundor/runtime-sdk';
import type { InlineConfig } from 'vite';
import { describe, expect, it, vi, type Mock } from 'vitest';

import {
  RUNTIME_ID,
  webBuild,
  webDev,
  webDoctor,
  webGen,
  webLicenses,
  webRuntime,
} from './index';
import {
  fakeLibrary,
  makeCtx,
  SOURCE_CLIENT_DIR,
  tempProject,
  testConfig,
  writeGenerated,
} from './testing';

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(dir, join(entry.parentPath, entry.name)).split('\\').join('/'),
    )
    .sort();
}

/** Generated contracts, without initializing a runtime or creating a host. */
async function preparedProject(config: ResolvedSoundorConfig = testConfig) {
  const root = await tempProject();
  const ctx = makeCtx(root);
  await webGen(config, ctx);
  await writeGenerated(ctx);
  return root;
}

interface FakeServer {
  listen: Mock<() => Promise<void>>;
  close: Mock<() => Promise<void>>;
  resolvedUrls: null;
}

function fakeServer(): FakeServer {
  return {
    listen: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    close: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    resolvedUrls: null,
  };
}

describe('webRuntime', () => {
  it('is a runtime descriptor factory for the web id', () => {
    expect(RUNTIME_ID).toBe('web');
    expect(webRuntime.id).toBe('web');
    const descriptor = webRuntime({ port: 4000 });
    expect(descriptor.id).toBe('web');
    expect(descriptor.options).toEqual({ port: 4000 });
    expect(descriptor.runtime).toBe(webRuntime.runtime);
    expect(webRuntime().options).toEqual({});
  });
});

describe('webGen', () => {
  it("resolves the config's editor into the manifest as the VST3 runtime does", async () => {
    const config = {
      ...testConfig,
      editor: { width: 1000, height: 640, resizable: true },
    } as unknown as ResolvedSoundorConfig;
    const ctx = makeCtx(await tempProject());
    await webGen(config, ctx);
    expect(JSON.parse(ctx.codegen.files()[0]!.contents).editor).toEqual({
      width: 1000,
      height: 640,
      minWidth: 1000,
      minHeight: 640,
      // Unbounded: Infinity, which JSON writes as null (readManifest).
      maxWidth: null,
      maxHeight: null,
      resizable: true,
      resize: 'layout',
      fit: 'contain',
      keepAspectRatio: false,
    });
  });

  it('emits the manifest: plugin identity and parameters, in order', async () => {
    const config = resolveConfig({
      plugin: testConfig.plugin,
      runtimes: [],
      parameters: {
        gain: {
          type: 'float32',
          label: 'Gain',
          min: 0,
          max: 1,
          default: 0.5,
          unit: 'dB',
        },
        steps: {
          type: 'int32',
          label: 'Steps',
          min: 1,
          max: 8,
          default: 4,
          access: 'manual',
        },
        bypass: { type: 'boolean', label: 'Bypass', default: false },
        mode: {
          type: 'choice',
          label: 'Mode',
          options: [
            { value: 'clean', label: 'Clean' },
            { value: 'warm', label: 'Warm' },
          ],
          default: 'warm',
        },
      },
    });
    const ctx = makeCtx(await tempProject());
    await webGen(config, ctx);

    const files = ctx.codegen.files();
    expect(files.map((file) => file.path)).toEqual([
      'manifest.json',
      'native.ts',
      'parameters.js',
    ]);
    expect(JSON.parse(files[0]!.contents)).toEqual({
      midi: { input: false, output: false },
      plugin: {
        id: 'com.example.basic',
        name: 'Soundor Basic',
        version: '0.1.0',
      },
      runtimeVersion: expect.any(String),
      controller: expect.any(Array),
      resources: [],
      // No editor in the config: the fixed 800×600 view every runtime opens.
      editor: {
        width: 800,
        height: 600,
        minWidth: 800,
        minHeight: 600,
        maxWidth: 800,
        maxHeight: 600,
        resizable: false,
        resize: 'layout',
        fit: 'contain',
        keepAspectRatio: false,
      },
      parameters: [
        {
          id: 'gain',
          label: 'Gain',
          access: 'automatable',
          type: 'float32',
          min: 0,
          max: 1,
          default: 0.5,
          unit: 'dB',
        },
        {
          id: 'steps',
          label: 'Steps',
          access: 'manual',
          type: 'int32',
          min: 1,
          max: 8,
          default: 4,
        },
        {
          id: 'bypass',
          label: 'Bypass',
          access: 'automatable',
          type: 'boolean',
          default: false,
        },
        {
          id: 'mode',
          label: 'Mode',
          access: 'automatable',
          type: 'choice',
          options: [
            { value: 'clean', label: 'Clean' },
            { value: 'warm', label: 'Warm' },
          ],
          default: 'warm',
        },
      ],
      native: { types: [], methods: [], events: [], streams: [] },
      state: { fields: [], types: [] },
    });
  });

  it('is deterministic, so `soundor gen --check` passes after `gen`', async () => {
    const root = await tempProject();
    const first = makeCtx(root);
    await webGen(testConfig, first);
    await writeGenerated(first);

    const again = makeCtx(root);
    await webGen(testConfig, again);
    expect(again.codegen.files()).toEqual(first.codegen.files());
    await expect(
      checkGeneratedFiles(again.fs, again.paths.gen, again.codegen.files()),
    ).resolves.toHaveLength(3);

    const changed = makeCtx(root);
    await webGen(
      { ...testConfig, plugin: { id: 'com.example.other', name: 'Other' } },
      changed,
    );
    await expect(
      checkGeneratedFiles(
        changed.fs,
        changed.paths.gen,
        changed.codegen.files(),
      ),
    ).rejects.toBeInstanceOf(GeneratedFilesOutOfDateError);
  });

  it('rejects invalid options', async () => {
    const ctx = makeCtx(await tempProject(), { options: { port: -1 } });
    await expect(webGen(testConfig, ctx)).rejects.toMatchObject({
      code: 'CONFIG',
    });
  });
});

describe('webLicenses', () => {
  it('reports what a build would ship, writing no build', async () => {
    const root = await preparedProject();
    const ctx = makeCtx(root, { mode: 'production' });
    const report = await webLicenses(testConfig, ctx, {
      clientDir: SOURCE_CLIENT_DIR,
    });
    const directories = report.notices.map((notice) => notice.directory);
    expect(directories).toEqual(
      expect.arrayContaining([
        'engine/engine',
        'engine/yoga',
        expect.stringMatching(/^javascript\/preact@/),
      ]),
    );
    expect(report.unused).toEqual([]);
    expect(existsSync(ctx.paths.dist)).toBe(false);
  });
});

describe('webBuild', () => {
  it('builds a static site with relative URLs into ctx.paths.dist only', async () => {
    const root = await preparedProject();
    const ctx = makeCtx(root, { mode: 'production' });

    await webBuild(testConfig, ctx, { clientDir: SOURCE_CLIENT_DIR });

    expect(ctx.paths.dist).toBe(join(root, '.soundor/dist/web'));
    const files = await listFiles(ctx.paths.dist);
    expect(files).toContain('index.html');
    expect(files.some((file) => /^assets\/.+\.js$/.test(file))).toBe(true);
    const html = await readFile(join(ctx.paths.dist, 'index.html'), 'utf8');
    expect(html).toMatch(/src="\.\/assets\/[^"]+\.js"/);
    expect(html).not.toMatch(/(src|href)="\//);

    const code = (
      await Promise.all(
        files
          .filter((file) => file.endsWith('.js'))
          .map((file) => readFile(join(ctx.paths.dist, file), 'utf8')),
      )
    ).join('\n');
    expect(code).toContain('Soundor Basic');
    expect(code).not.toContain(root);

    expect(
      (await listFiles(root)).some((file) => file.startsWith('runtimes/')),
    ).toBe(false);
  });

  it("ships the build's third-party notices in licenses/", async () => {
    const root = await preparedProject();
    const ctx = makeCtx(root, { mode: 'production' });
    await webBuild(testConfig, ctx, { clientDir: SOURCE_CLIENT_DIR });
    const files = await listFiles(join(ctx.paths.dist, 'licenses'));
    expect(files).toContain('THIRD-PARTY-NOTICES.txt');
    expect(files).toContain('licenses.json');
    expect(files).toContain('engine/yoga/LICENSE');
    expect(
      files.some((file) => /^javascript\/preact@[^/]+\/LICENSE$/.test(file)),
    ).toBe(true);
    expect(ctx.logger.lines).toContainEqual(
      expect.objectContaining({
        level: 'info',
        message: expect.stringMatching(
          /^Licenses: \d+ components .* -> licenses\/$/,
        ),
      }),
    );
  });

  it('keeps the output directory free of stale files', async () => {
    const root = await preparedProject();
    const ctx = makeCtx(root, { mode: 'production' });
    await webBuild(testConfig, ctx, { clientDir: SOURCE_CLIENT_DIR });
    await writeFile(join(ctx.paths.dist, 'stale.txt'), 'old');

    await webBuild(testConfig, ctx, { clientDir: SOURCE_CLIENT_DIR });

    expect(await listFiles(ctx.paths.dist)).not.toContain('stale.txt');
  });

  it("reports Vite's own error when the build fails", async () => {
    const root = await preparedProject();
    const build = vi.fn<() => Promise<void>>(() =>
      Promise.reject(new Error("Unknown Soundor module 'soundor:nope'")),
    );
    await expect(
      webBuild(testConfig, makeCtx(root), { build: build as never }),
    ).rejects.toMatchObject({
      code: 'RUNTIME',
      message:
        "Vite failed to build the Web host: Unknown Soundor module 'soundor:nope'",
    });
  });

  it('rejects a legacy host even when explicit inputs are configured', async () => {
    const root = await tempProject();
    await mkdir(join(root, 'runtimes/web'), { recursive: true });
    const ctx = makeCtx(root, { options: { inputs: [] } });
    const build = vi.fn<() => Promise<void>>();
    await expect(
      webBuild(testConfig, ctx, { build: build as never }),
    ).rejects.toMatchObject({
      code: 'CONFIG',
      message: expect.stringContaining('Move custom inputs'),
    });
    expect(build).not.toHaveBeenCalled();
  });
});

describe('webDev', () => {
  it('serves the Web host until the signal aborts, then closes the server', async () => {
    const root = await preparedProject();
    const controller = new AbortController();
    const ctx = makeCtx(root, {
      options: { port: 0 },
      signal: controller.signal,
    });

    const running = webDev(testConfig, ctx, { clientDir: SOURCE_CLIENT_DIR });
    await vi.waitFor(
      () => {
        expect(
          ctx.logger.lines.some((line) =>
            line.message.startsWith('Web host ready: http://'),
          ),
        ).toBe(true);
      },
      { timeout: 10_000 },
    );
    const ready = ctx.logger.lines.find((line) =>
      line.message.startsWith('Web host ready: '),
    )!;
    const url = ready.message.slice('Web host ready: '.length);

    const html = await (await fetch(url)).text();
    expect(html).toContain('<div id="soundor"></div>');
    const main = await (await fetch(new URL('@soundor/host.js', url))).text();
    expect(main).toContain('startSoundorWebHost');

    controller.abort();
    await running;
    await expect(fetch(url)).rejects.toThrow('fetch failed');
  });

  it('closes a server it created when aborted during startup', async () => {
    const root = await preparedProject();
    const controller = new AbortController();
    controller.abort();
    const server = fakeServer();
    const createServer = vi.fn<() => Promise<FakeServer>>(() =>
      Promise.resolve(server),
    );

    await webDev(testConfig, makeCtx(root, { signal: controller.signal }), {
      createServer: createServer as never,
    });

    expect(server.listen).not.toHaveBeenCalled();
    expect(server.close).toHaveBeenCalledOnce();
  });

  it("reports Vite's own error when the dev server cannot start", async () => {
    const root = await preparedProject();
    const createServer = vi.fn<() => Promise<FakeServer>>(() =>
      Promise.reject(new Error('Failed to load vite.config.ts')),
    );
    await expect(
      webDev(testConfig, makeCtx(root), {
        createServer: createServer as never,
      }),
    ).rejects.toMatchObject({
      code: 'RUNTIME',
      message:
        'Vite failed to start the Web host dev server: Failed to load vite.config.ts',
    });
  });

  it('passes the configured port to Vite', async () => {
    const root = await preparedProject();
    const controller = new AbortController();
    controller.abort();
    const createServer = vi.fn<(config: InlineConfig) => Promise<FakeServer>>(
      () => Promise.resolve(fakeServer()),
    );
    await webDev(
      testConfig,
      makeCtx(root, { options: { port: 4321 }, signal: controller.signal }),
      { createServer: createServer as never },
    );
    expect(createServer.mock.calls[0]![0].server?.port).toBe(4321);
  });

  it('reports its URL to the dev session and opens it on a shortcut', async () => {
    const root = await preparedProject();
    const controller = new AbortController();
    const openBrowser = vi.fn<() => void>();
    const server = {
      ...fakeServer(),
      resolvedUrls: { local: ['http://localhost:5173/'], network: [] },
      openBrowser,
    };
    const shortcuts: DevShortcut[] = [];
    const ready: (readonly DevSummaryRow[] | undefined)[] = [];
    const ctx = {
      ...makeCtx(root, { signal: controller.signal }),
      session: {
        ready(rows?: readonly DevSummaryRow[]) {
          ready.push(rows);
          controller.abort();
        },
        shortcut: (shortcut: DevShortcut) => shortcuts.push(shortcut),
      },
    };

    await webDev(testConfig, ctx, {
      createServer: (() => Promise.resolve(server)) as never,
    });

    expect(ready).toEqual([
      [{ label: 'Web host', value: 'http://localhost:5173/' }],
    ]);
    expect(shortcuts.map((shortcut) => shortcut.key)).toEqual(['w']);
    await shortcuts[0]!.action();
    expect(openBrowser).toHaveBeenCalledOnce();
  });
});

describe('webDoctor', () => {
  it('reports Node.js, Vite, the WebAssembly target and the Web host project', async () => {
    const root = await tempProject();
    const ctx = makeCtx(root);

    const report = await webDoctor(testConfig, ctx);
    expect(report.checks.map((check) => check.label)).toEqual([
      'Node.js',
      'Vite',
      'Rust WebAssembly target',
      'Managed Web host',
    ]);
    expect(report.checks[0]!.status).toBe('ok');
    expect(report.checks[1]!.status).toBe('ok');
    expect(report.checks[3]).toMatchObject({
      status: 'ok',
    });

    expect(
      report.checks.every((check) => !/cmake|vst3|c\+\+/i.test(check.label)),
    ).toBe(true);
  });
});

describe('the Rust library', () => {
  it('rebuilds lib on source changes, reloads the page, and stops watching on abort', async () => {
    const root = await tempProject();
    const controller = new AbortController();
    const lib = fakeLibrary(root);
    let changed: (() => void) | undefined;
    const stop = vi.fn<() => void>();
    const ctx = makeCtx(root, {
      signal: controller.signal,
      lib: {
        ...lib,
        onChange: (listener) => {
          changed = listener;
          return stop;
        },
      },
    });
    const module = {};
    const server = {
      ...fakeServer(),
      moduleGraph: {
        getModuleById: vi.fn<() => object>(() => module),
        invalidateModule: vi.fn<(module: object) => void>(),
      },
      ws: { send: vi.fn<(message: { type: string }) => void>() },
    };
    const running = webDev(testConfig, ctx, {
      createServer: (async () => server) as never,
    });
    try {
      await vi.waitFor(() => expect(server.listen).toHaveBeenCalledOnce());
      changed!();
      await vi.waitFor(() =>
        expect(server.ws.send).toHaveBeenCalledWith({ type: 'full-reload' }),
      );
      expect(lib.requests).toEqual(
        Array.from({ length: 2 }, () => ({
          crateType: 'cdylib',
          target: 'wasm32-unknown-unknown',
          profile: 'release',
        })),
      );
      expect(server.moduleGraph.invalidateModule).toHaveBeenCalledWith(module);
    } finally {
      controller.abort();
      await running;
    }
    expect(stop).toHaveBeenCalledOnce();
    expect(server.close).toHaveBeenCalledOnce();
  });

  it('is compiled to WebAssembly, optimized, for dev and build', async () => {
    const root = await tempProject();
    const lib = fakeLibrary(root);
    const ctx = makeCtx(root, { lib });
    await webGen(testConfig, ctx);
    const build = vi.fn<() => Promise<undefined>>(
      async () => undefined,
    ) as never;
    await webBuild(testConfig, ctx, { build });
    expect(lib.requests).toEqual([
      {
        crateType: 'cdylib',
        target: 'wasm32-unknown-unknown',
        profile: 'release',
      },
    ]);
  });

  it('is required: a project without lib/ is told to create it', async () => {
    const root = await tempProject();
    const ctx = makeCtx(root, { lib: null });
    await expect(
      webBuild(testConfig, ctx, { build: vi.fn<() => void>() as never }),
    ).rejects.toThrow(/no Rust library \(lib\/Cargo.toml\)[\s\S]*soundor gen/);
  });
});
