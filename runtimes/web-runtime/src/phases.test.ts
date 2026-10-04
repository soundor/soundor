import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import {
  checkGeneratedFiles,
  GeneratedFilesOutOfDateError,
  type SoundorConfig,
} from '@soundor/runtime-sdk';
import type { InlineConfig } from 'vite';
import { describe, expect, it, vi, type Mock } from 'vitest';

import {
  RUNTIME_ID,
  webBuild,
  webDev,
  webDoctor,
  webGen,
  webInit,
  webRuntime,
} from './index';
import {
  makeCtx,
  SOURCE_CLIENT_DIR,
  tempProject,
  testConfig,
  writeGenerated,
} from './testing';

const PACKAGE_MANAGER_FILES = [
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'node_modules',
];

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(dir, join(entry.parentPath, entry.name)).split('\\').join('/'),
    )
    .sort();
}

/** An initialized, generated project; the scaffold's vite.config.ts imports
 * the built package, which tests run without, so it is replaced. */
async function preparedProject(config: SoundorConfig = testConfig) {
  const root = await tempProject();
  const ctx = makeCtx(root);
  await webInit(config, ctx);
  await webGen(config, ctx);
  await writeGenerated(ctx);
  await writeFile(
    join(root, 'runtimes/web/vite.config.ts'),
    'export default {};\n',
  );
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

describe('webInit', () => {
  it('scaffolds the user-owned Web host under runtimes/web', async () => {
    const root = await tempProject();
    await webInit(testConfig, makeCtx(root));

    expect(await listFiles(join(root, 'runtimes/web'))).toEqual([
      'index.html',
      'src/audio.ts',
      'src/main.ts',
      'src/native.ts',
      'tsconfig.json',
      'vite.config.ts',
    ]);
    const html = await readFile(join(root, 'runtimes/web/index.html'), 'utf8');
    expect(html).toContain('<title>Soundor Basic</title>');
    expect(html).toContain('src="./src/main.ts"');
    const main = await readFile(join(root, 'runtimes/web/src/main.ts'), 'utf8');
    expect(main).toContain(
      "import { startSoundorWebHost } from '@soundor/web-runtime/client';",
    );
    expect(main).toContain("native: () => import('./native')");
    expect(main).toContain("audio: () => import('./audio')");
    const native = await readFile(
      join(root, 'runtimes/web/src/native.ts'),
      'utf8',
    );
    expect(native).toContain(
      "import type { WebNativeApi } from '../../../.soundor/generated/runtimes/web/native';",
    );
    expect(native).toContain('export const native: WebNativeApi = {');
    // The plugin declares a float gain: the scaffold applies it.
    const audio = await readFile(
      join(root, 'runtimes/web/src/audio.ts'),
      'utf8',
    );
    expect(audio).toContain('export const setupAudio: WebAudioSetup');
    expect(audio).toContain('parameters.gain.subscribe');
    const vite = await readFile(
      join(root, 'runtimes/web/vite.config.ts'),
      'utf8',
    );
    expect(vite).toContain('defineWebConfig');
    const tsconfig = await readFile(
      join(root, 'runtimes/web/tsconfig.json'),
      'utf8',
    );
    expect(tsconfig).toContain('"../../.soundor/generated/parameters.d.ts"');
  });

  it('never overwrites an existing file', async () => {
    const root = await tempProject();
    const ctx = makeCtx(root);
    await webInit(testConfig, ctx);
    const main = join(root, 'runtimes/web/src/main.ts');
    await writeFile(main, 'EDITED');
    await rm(join(root, 'runtimes/web/index.html'));

    await webInit(testConfig, ctx);

    expect(await readFile(main, 'utf8')).toBe('EDITED');
    expect(await stat(join(root, 'runtimes/web/index.html'))).toBeTruthy();
    expect(ctx.logger.lines).toContainEqual({
      level: 'info',
      message: 'skip runtimes/web/src/main.ts (exists)',
    });
  });

  it('creates no package manager project and names no package manager', async () => {
    const root = await tempProject();
    await webInit(testConfig, makeCtx(root));

    const files = await listFiles(join(root, 'runtimes/web'));
    for (const name of PACKAGE_MANAGER_FILES) {
      expect(files.some((file) => file.split('/').includes(name))).toBe(false);
    }
    for (const file of files) {
      const contents = await readFile(join(root, 'runtimes/web', file), 'utf8');
      expect(contents).not.toMatch(/\b(pnpm|npm|npx|yarn|bun|bunx)\b/);
    }
  });
});

describe('webGen', () => {
  it('emits the manifest: plugin identity and parameters, in order', async () => {
    const config = {
      ...testConfig,
      parameters: [
        {
          type: 'float',
          id: 'gain',
          label: 'Gain',
          min: 0,
          max: 1,
          default: 0.5,
          unit: 'dB',
        },
        {
          type: 'int',
          id: 'steps',
          label: 'Steps',
          min: 1,
          max: 8,
          default: 4,
        },
        { type: 'bool', id: 'bypass', label: 'Bypass', default: false },
        {
          type: 'enum',
          id: 'mode',
          label: 'Mode',
          values: ['clean', 'warm'],
          default: 'warm',
        },
      ],
    } as unknown as SoundorConfig;
    const ctx = makeCtx(await tempProject());
    await webGen(config, ctx);

    const files = ctx.codegen.files();
    expect(files.map((file) => file.path)).toEqual([
      'manifest.json',
      'native.ts',
    ]);
    expect(JSON.parse(files[0]!.contents)).toEqual({
      plugin: { id: 'com.example.basic', name: 'Soundor Basic' },
      parameters: [
        {
          id: 'gain',
          label: 'Gain',
          type: 'float',
          min: 0,
          max: 1,
          default: 0.5,
          unit: 'dB',
        },
        {
          id: 'steps',
          label: 'Steps',
          type: 'int',
          min: 1,
          max: 8,
          default: 4,
        },
        { id: 'bypass', label: 'Bypass', type: 'bool', default: false },
        {
          id: 'mode',
          label: 'Mode',
          type: 'enum',
          values: ['clean', 'warm'],
          default: 'warm',
        },
      ],
      native: { methods: [] },
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
    ).resolves.toHaveLength(2);

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

    // Nothing else is written into the project.
    expect((await listFiles(join(root, 'runtimes/web'))).sort()).toEqual([
      'index.html',
      'src/audio.ts',
      'src/main.ts',
      'src/native.ts',
      'tsconfig.json',
      'vite.config.ts',
    ]);
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

  it('reports a missing scaffold', async () => {
    const ctx = makeCtx(await tempProject());
    const build = vi.fn<() => Promise<void>>();
    await expect(
      webBuild(testConfig, ctx, { build: build as never }),
    ).rejects.toMatchObject({
      code: 'CONFIG',
      message: expect.stringContaining('soundor init web'),
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
    const main = await (await fetch(new URL('src/main.ts', url))).text();
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
});

describe('webDoctor', () => {
  it('reports Node.js, Vite and the Web host project', async () => {
    const root = await tempProject();
    const ctx = makeCtx(root);

    const before = await webDoctor(testConfig, ctx);
    expect(before.checks.map((check) => check.label)).toEqual([
      'Node.js',
      'Vite',
      'Web host project',
    ]);
    expect(before.checks[0]!.status).toBe('ok');
    expect(before.checks[1]!.status).toBe('ok');
    expect(before.checks[2]).toMatchObject({
      status: 'warn',
      suggestion: expect.stringContaining('soundor init web'),
    });

    await webInit(testConfig, ctx);
    const after = await webDoctor(testConfig, ctx);
    expect(after.checks[2]!.status).toBe('ok');
    expect(
      after.checks.every((check) => !/cmake|juce|c\+\+/i.test(check.label)),
    ).toBe(true);
  });
});
