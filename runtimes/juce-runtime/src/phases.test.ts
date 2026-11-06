import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createNodeFileSystem,
  type CommandProbe,
  type DevShortcut,
  type DevSummaryRow,
  type RunCommandOptions,
  type SoundorConfig,
} from '@soundor/runtime-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HostModule } from './dev-host';
import { juceBuild, juceDev, juceGen, juceInit } from './index';
import type { JuceOptions } from './options';
import { makeCtx } from './testing';

const config = {
  plugin: { id: 'com.example.basic', name: 'Soundor Basic' },
  runtimes: [],
  parameters: [
    { type: 'float', id: 'gain', label: 'Gain', min: 0, max: 1, default: 0.5 },
  ],
  native: {},
} as unknown as SoundorConfig;

const okProbe: CommandProbe = () => ({ ok: true, version: '1.2.3' });

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** A temp project root with a seeded JUCE checkout; auto-cleaned by mkdtemp scope. */
async function tempProjectWithJuce(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'juce-runtime-'));
  await mkdir(join(root, 'JUCE', 'modules'), { recursive: true });
  await writeFile(join(root, 'JUCE', 'CMakeLists.txt'), '# juce');
  return root;
}

/** A UI bundle as the CLI leaves it: the ES module, then its build id. */
async function writeBundle(
  dir: string,
): Promise<{ dir: string; module: string }> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'bundle.mjs'),
    "import { plugin } from 'soundor:host';\nconsole.info(plugin.name);\n",
  );
  await writeFile(join(dir, 'build-id'), 'build-1');
  return { dir, module: 'bundle.mjs' };
}

afterEach(() => vi.restoreAllMocks());

describe('juceInit', () => {
  it('scaffolds the user-owned host under runtimes/juce and is idempotent', async () => {
    const ctx = makeCtx();
    await juceInit(config, ctx);

    const cmake = ctx.fs.resolve('runtimes/juce/CMakeLists.txt');
    expect(await ctx.fs.exists(cmake)).toBe(true);
    expect(
      await ctx.fs.exists(ctx.fs.resolve('runtimes/juce/PluginProcessor.cpp')),
    ).toBe(true);

    const contents = await ctx.fs.read(cmake);
    // The only injected line: include the generated setup.cmake (user owns the rest).
    expect(contents).toContain(
      'include(${CMAKE_CURRENT_SOURCE_DIR}/../../.soundor/generated/runtimes/juce/setup.cmake)',
    );
    expect(contents).toContain('project(');
    // Plugin plumbing (juce_add_plugin) belongs to the generated setup, not here.
    expect(contents).not.toContain('juce_add_plugin');

    // The scaffold inherits the generated framework.
    const proc = await ctx.fs.read(
      ctx.fs.resolve('runtimes/juce/PluginProcessor.h'),
    );
    expect(proc).toContain('public soundor::AudioProcessor');

    // The scaffold ships a working gain out of the box: applied (ramped) from
    // the generated gainParameter pointer, and buses constrained so it works in
    // a DAW that negotiates layouts (e.g. Reaper), not just standalone.
    const procSource = await ctx.fs.read(
      ctx.fs.resolve('runtimes/juce/PluginProcessor.cpp'),
    );
    expect(procSource).toContain('gainParameter->load()');
    expect(procSource).toContain('applyGainRamp');
    expect(procSource).toContain('isBusesLayoutSupported');

    // Re-init must not overwrite user edits.
    await ctx.fs.write(cmake, 'EDITED');
    await juceInit(config, ctx);
    expect(await ctx.fs.read(cmake)).toBe('EDITED');
  });
});

describe('juceGen', () => {
  it('emits the generated framework through the codegen sink', async () => {
    const ctx = makeCtx();
    await juceGen(config, ctx);
    expect(ctx.codegen.files().map((f) => f.path)).toEqual([
      'setup.cmake',
      'soundor/soundor.h',
      'soundor/SoundorProcessor.h',
      'soundor/SoundorProcessor.cpp',
      'soundor/SoundorEditor.h',
      'soundor/SoundorEditor.cpp',
      'soundor/native/SoundorNative.h',
      'soundor/native/SoundorNative.cpp',
    ]);
  });
});

describe('juceDev', () => {
  it('configures and builds a debug build', async () => {
    const root = await tempProjectWithJuce();
    const controller = new AbortController();
    controller.abort(); // dev returns as soon as the (already-aborted) signal fires.
    const ctx = makeCtx({
      root,
      fs: createNodeFileSystem(root),
      options: { jucePath: join(root, 'JUCE') },
      signal: controller.signal,
    });
    const calls: string[][] = [];
    const run = (o: RunCommandOptions) => {
      calls.push([o.cmd, ...o.args]);
      return Promise.resolve();
    };

    await juceDev(config, ctx, { run, probe: okProbe });

    const configure = calls[0]!;
    expect(configure).toContain('-DJUCE_DIR=' + join(root, 'JUCE'));
    expect(configure).toContain('-DSOUNDOR_NODE_EXE=' + process.execPath);
    // Automatic engine selection unless the project selects a mode.
    expect(configure).toContain('-DSOUNDOR_ENGINE_MODE=prebuilt');
    // No UI: the cached UI directory is cleared explicitly.
    expect(configure).toContain('-DSOUNDOR_UI_DIR=');
    expect(configure).toContain('-DSOUNDOR_UI_DEV_DIR=');
    expect(configure).toContain('-DSOUNDOR_UI_DEV_LOG=');
    expect(calls.some((c) => c.includes('--build'))).toBe(true);
  });

  it('loads a live UI from disk instead of embedding it', async () => {
    const root = await tempProjectWithJuce();
    const controller = new AbortController();
    controller.abort();
    const ctx = {
      ...makeCtx({
        root,
        fs: createNodeFileSystem(root),
        options: { jucePath: join(root, 'JUCE') },
        signal: controller.signal,
      }),
      ui: {
        ...(await writeBundle(join(root, 'ui'))),
        live: {
          logFile: join(root, 'ui.log'),
          onBuild: () => () => {},
          sourceMap: vi.fn(() => Promise.resolve()),
        },
      },
    };
    const calls: string[][] = [];
    const run = (o: RunCommandOptions) => {
      calls.push([o.cmd, ...o.args]);
      return Promise.resolve();
    };

    await juceDev(config, ctx, { run, probe: okProbe });

    const configure = calls[0]!;
    const uiDir = join(ctx.paths.cache, 'ui-debug');
    expect(configure).toContain('-DSOUNDOR_UI_DIR=');
    expect(configure).toContain('-DSOUNDOR_UI_DEV_DIR=' + uiDir);
    expect(configure).toContain('-DSOUNDOR_UI_DEV_LOG=' + join(root, 'ui.log'));
    // The engine's form of the bundle, made before the plugin is built.
    expect(await readFile(join(uiDir, 'bundle.js'), 'utf8')).toMatch(
      /^\(function \(exports, require, module\) \{/,
    );
    expect(await readFile(join(uiDir, 'build-id'), 'utf8')).toBe('build-1');
  });

  it.each(['', 'Debug'])(
    'launches standalone from the %s configuration directory',
    async (configuration) => {
      const root = await tempProjectWithJuce();
      const controller = new AbortController();
      controller.abort();
      const ctx = makeCtx({
        root,
        fs: createNodeFileSystem(root),
        options: {
          jucePath: join(root, 'JUCE'),
          formats: ['vst3', 'standalone'],
        },
        signal: controller.signal,
      });
      const launched: string[] = [];
      const run = async (o: RunCommandOptions) => {
        if (o.args[0] !== '--build') return;
        const standalone = join(
          o.args[1]!,
          'SoundorBasic_artefacts',
          configuration,
          'Standalone',
          'Soundor Basic',
        );
        await mkdir(join(standalone, '..'), { recursive: true });
        await writeFile(standalone, 'binary');
        await chmod(standalone, 0o755);
      };

      await juceDev(config, ctx, {
        run,
        probe: okProbe,
        platform: 'linux',
        launchStandalone: (target) => {
          launched.push(target);
          return true;
        },
      });

      expect(launched).toEqual([
        join(
          ctx.paths.cache,
          'build-debug',
          'SoundorBasic_artefacts',
          configuration,
          'Standalone',
          'Soundor Basic',
        ),
      ]);
    },
  );

  it('reports the build to the dev session and relaunches on its shortcut', async () => {
    const root = await tempProjectWithJuce();
    const controller = new AbortController();
    controller.abort();
    const shortcuts: DevShortcut[] = [];
    const ready: (readonly DevSummaryRow[] | undefined)[] = [];
    const ctx = {
      ...makeCtx({
        root,
        fs: createNodeFileSystem(root),
        options: {
          jucePath: join(root, 'JUCE'),
          formats: ['vst3', 'standalone'],
        },
        signal: controller.signal,
      }),
      session: {
        ready: (rows?: readonly DevSummaryRow[]) => ready.push(rows),
        shortcut: (shortcut: DevShortcut) => shortcuts.push(shortcut),
      },
    };
    const artefacts = join(
      ctx.paths.cache,
      'build-debug',
      'SoundorBasic_artefacts',
      'Debug',
    );
    const standalone = join(artefacts, 'Standalone', 'Soundor Basic');
    const run = async (o: RunCommandOptions) => {
      if (o.args[0] !== '--build') return;
      await mkdir(join(standalone, '..'), { recursive: true });
      await writeFile(standalone, 'binary');
      await chmod(standalone, 0o755);
    };
    const launched: string[] = [];

    await juceDev(config, ctx, {
      run,
      probe: okProbe,
      platform: 'linux',
      launchStandalone: (target) => {
        launched.push(target);
        return true;
      },
    });

    expect(ready).toEqual([
      [
        { label: 'Formats', value: 'VST3, Standalone' },
        { label: 'Plugins', value: artefacts },
        { label: 'Standalone', value: standalone },
      ],
    ]);
    expect(shortcuts.map((shortcut) => shortcut.key)).toEqual(['s']);
    await shortcuts[0]!.action();
    expect(launched).toEqual([standalone, standalone]);
  });

  describe('with the VST3 host', () => {
    /** A build with both formats, and a host that records what it opened. */
    async function devWith(
      options: JuceOptions,
      module: HostModule | undefined,
    ) {
      const root = await tempProjectWithJuce();
      const controller = new AbortController();
      controller.abort();
      const shortcuts: DevShortcut[] = [];
      const ready: (readonly DevSummaryRow[] | undefined)[] = [];
      const ctx = {
        ...makeCtx({
          root,
          fs: createNodeFileSystem(root),
          options: {
            jucePath: join(root, 'JUCE'),
            formats: ['vst3', 'standalone'],
            ...options,
          },
          signal: controller.signal,
        }),
        session: {
          ready: (rows?: readonly DevSummaryRow[]) => ready.push(rows),
          shortcut: (shortcut: DevShortcut) => shortcuts.push(shortcut),
        },
      };
      const artefacts = join(
        ctx.paths.cache,
        'build-debug',
        'SoundorBasic_artefacts',
        'Debug',
      );
      const standalone = join(artefacts, 'Standalone', 'Soundor Basic.app');
      const plugin = join(artefacts, 'VST3', 'Soundor Basic.vst3');
      const run = async (o: RunCommandOptions) => {
        if (o.args[0] !== '--build') return;
        await mkdir(standalone, { recursive: true });
        await mkdir(plugin, { recursive: true });
      };
      const launched: string[] = [];
      await juceDev(config, ctx, {
        run,
        probe: okProbe,
        platform: 'darwin',
        launchStandalone: (target) => {
          launched.push(target);
          return true;
        },
        loadHost: async () => module,
      });
      return { launched, standalone, plugin, shortcuts, ready };
    }

    function fakeHostModule(): HostModule & { opened: string[] } {
      const opened: string[] = [];
      return {
        opened,
        resolveHost: () => ({
          executable: '/host',
          source: 'explicit',
          reason: 'test',
        }),
        prepareHost: async () => {
          throw new Error('not needed');
        },
        launchHost: async (options: { plugin: string }) => {
          opened.push(options.plugin);
          return {
            once: () => {},
            exited: new Promise(() => {}),
            getState: async () => ({
              component: new Uint8Array(),
              controller: new Uint8Array(),
            }),
            setState: async () => {},
            close: async () => ({ code: 0, signal: null }),
          };
        },
      } as unknown as HostModule & { opened: string[] };
    }

    it('opens the VST3 in the host rather than the Standalone', async () => {
      const module = fakeHostModule();
      const { launched, plugin, shortcuts, ready } = await devWith({}, module);
      expect(module.opened).toEqual([plugin]);
      expect(launched).toEqual([]);
      expect(shortcuts.map((shortcut) => shortcut.key)).toEqual(['v', 's']);
      expect(ready[0]).toContainEqual({ label: 'VST3', value: plugin });
    });

    it('opens the Standalone without the host', async () => {
      const { launched, standalone, shortcuts } = await devWith({}, undefined);
      expect(launched).toEqual([standalone]);
      expect(shortcuts.map((shortcut) => shortcut.key)).toEqual(['s']);
    });

    it('follows dev.launch, and the other stays a key away', async () => {
      const module = fakeHostModule();
      const { launched, standalone, plugin, shortcuts } = await devWith(
        { dev: { launch: 'standalone' } },
        module,
      );
      expect(launched).toEqual([standalone]);
      expect(module.opened).toEqual([]);
      await shortcuts.find((shortcut) => shortcut.key === 's')!.action();
      expect(launched).toEqual([standalone, standalone]);
      expect(plugin).toContain('.vst3');
    });

    it('opens nothing with dev.launch: false', async () => {
      const module = fakeHostModule();
      const { launched } = await devWith({ dev: { launch: false } }, module);
      expect(launched).toEqual([]);
      expect(module.opened).toEqual([]);
    });

    it('goes on to the Standalone when the host cannot be made ready', async () => {
      const module = fakeHostModule();
      module.resolveHost = () => {
        throw Object.assign(new Error('no executable'), {
          code: 'executable-not-found',
        });
      };
      module.prepareHost = async () => {
        throw new Error('the link failed');
      };
      const { launched, standalone, shortcuts } = await devWith({}, module);
      expect(launched).toEqual([standalone]);
      expect(module.opened).toEqual([]);
      expect(shortcuts.map((shortcut) => shortcut.key)).toEqual(['v', 's']);
    });

    it('fails when dev.launch: "vst3" cannot have its host', async () => {
      const module = fakeHostModule();
      module.resolveHost = () => {
        throw Object.assign(new Error('no executable'), {
          code: 'executable-not-found',
        });
      };
      module.prepareHost = async () => {
        throw new Error('the link failed');
      };
      await expect(
        devWith({ dev: { launch: 'vst3' } }, module),
      ).rejects.toThrow('the link failed');
    });

    it('refuses dev.launch: "vst3" without the host, before building', async () => {
      await expect(
        devWith({ dev: { launch: 'vst3' } }, undefined),
      ).rejects.toThrow(/@soundor\/vst3-host/);
    });
  });
});

describe('juceBuild', () => {
  it('builds Release and collects artefacts into dist', async () => {
    const root = await tempProjectWithJuce();
    const ctx = makeCtx({
      root,
      fs: createNodeFileSystem(root),
      options: { jucePath: join(root, 'JUCE'), engine: { mode: 'source' } },
      mode: 'production',
    });
    const calls: string[][] = [];
    const run = async (o: RunCommandOptions) => {
      calls.push([o.cmd, ...o.args]);
      if (o.args[0] === '--build') {
        const buildDir = o.args[1]!;
        const artefacts = join(buildDir, 'Plugin_artefacts', 'Release');
        await mkdir(artefacts, { recursive: true });
        await writeFile(join(artefacts, 'Plugin.vst3'), 'binary');
      }
    };

    await juceBuild(config, ctx, { run, probe: okProbe });

    expect(calls[0]).toContain('-DJUCE_DIR=' + join(root, 'JUCE'));
    expect(calls[0]).toContain('-DSOUNDOR_NODE_EXE=' + process.execPath);
    expect(calls[0]).toContain('-DSOUNDOR_ENGINE_MODE=source');
    const copied = join(
      ctx.paths.dist,
      'Plugin_artefacts',
      'Release',
      'Plugin.vst3',
    );
    expect(await exists(copied)).toBe(true);
    expect(await readFile(copied, 'utf8')).toBe('binary');
  });

  describe('with mode debug', () => {
    /** A build that leaves what JUCE leaves in a Debug build's artefacts. */
    async function building(calls: string[][]) {
      return async (o: RunCommandOptions) => {
        calls.push([o.cmd, ...o.args]);
        if (o.args[0] !== '--build') return;
        const debug = join(o.args[1]!, 'Plugin_artefacts', 'Debug');
        const bundle = join(debug, 'VST3', 'My Plugin.vst3', 'Contents');
        await mkdir(bundle, { recursive: true });
        await writeFile(join(bundle, 'binary'), 'new');
        await mkdir(join(debug, 'Standalone'), { recursive: true });
        await writeFile(join(debug, 'Standalone', 'My Plugin'), 'app');
        await writeFile(join(debug, 'libPlugin_SharedCode.a'), 'library');
      };
    }

    async function debugCtx() {
      const root = await tempProjectWithJuce();
      return {
        ...makeCtx({
          root,
          fs: createNodeFileSystem(root),
          options: { jucePath: join(root, 'JUCE'), engine: { mode: 'source' } },
          mode: 'debug',
        }),
        ui: await writeBundle(join(root, 'ui')),
      };
    }

    it('builds Debug with DevTools and the UI embedded', async () => {
      const ctx = await debugCtx();
      const calls: string[][] = [];

      await juceBuild(config, ctx, {
        run: await building(calls),
        probe: okProbe,
      });

      const uiDir = join(ctx.paths.cache, 'ui-debug-build');
      const buildDir = join(ctx.paths.cache, 'build-debug-build');
      expect(calls[0]).toContain(buildDir);
      expect(calls[0]).toContain('-DCMAKE_BUILD_TYPE=Debug');
      expect(calls[0]).toContain('-DSOUNDOR_ENABLE_DEVTOOLS=ON');
      expect(calls[0]).toContain('-DSOUNDOR_UI_DIR=' + uiDir);
      expect(calls[0]).toContain('-DSOUNDOR_UI_DEV_DIR=');
      expect(calls[1]).toEqual([
        'cmake',
        '--build',
        buildDir,
        '--config',
        'Debug',
        '--parallel',
      ]);
      expect(await exists(join(uiDir, 'bundle.js'))).toBe(true);
    });

    it('puts each format directly in the output', async () => {
      const ctx = await debugCtx();
      await juceBuild(config, ctx, { run: await building([]), probe: okProbe });

      const { dist } = ctx.paths;
      expect(
        await readFile(
          join(dist, 'VST3', 'My Plugin.vst3', 'Contents', 'binary'),
          'utf8',
        ),
      ).toBe('new');
      expect(await exists(join(dist, 'Standalone', 'My Plugin'))).toBe(true);
      expect(await exists(join(dist, 'libPlugin_SharedCode.a'))).toBe(false);
      expect(await exists(join(dist, 'Plugin_artefacts'))).toBe(false);
    });

    it('replaces its own output and leaves the rest of the folder', async () => {
      const ctx = await debugCtx();
      const { dist } = ctx.paths;
      const stale = join(dist, 'VST3', 'My Plugin.vst3', 'stale');
      await mkdir(join(dist, 'VST3', 'My Plugin.vst3'), { recursive: true });
      await writeFile(stale, 'old');
      await mkdir(join(dist, 'VST3', 'Other.vst3'), { recursive: true });
      await writeFile(join(dist, 'notes.txt'), 'mine');

      await juceBuild(config, ctx, { run: await building([]), probe: okProbe });

      expect(await exists(stale)).toBe(false);
      expect(await exists(join(dist, 'VST3', 'Other.vst3'))).toBe(true);
      expect(await exists(join(dist, 'notes.txt'))).toBe(true);
    });

    it('does not use the UI of soundor dev', async () => {
      const ctx = await debugCtx();
      const devUi = join(ctx.paths.cache, 'ui-debug', 'bundle.js');
      await mkdir(join(ctx.paths.cache, 'ui-debug'), { recursive: true });
      await writeFile(devUi, 'dev');

      await juceBuild(config, ctx, { run: await building([]), probe: okProbe });

      expect(await readFile(devUi, 'utf8')).toBe('dev');
    });
  });

  it("embeds the UI in the engine's form, compact", async () => {
    const root = await tempProjectWithJuce();
    const ctx = {
      ...makeCtx({
        root,
        fs: createNodeFileSystem(root),
        options: { jucePath: join(root, 'JUCE') },
        mode: 'production',
      }),
      ui: await writeBundle(join(root, 'ui')),
    };
    const calls: string[][] = [];
    const run = (o: RunCommandOptions) => {
      calls.push([o.cmd, ...o.args]);
      return Promise.resolve();
    };

    await juceBuild(config, ctx, { run, probe: okProbe });

    const uiDir = join(ctx.paths.cache, 'ui-release');
    expect(calls[0]).toContain('-DSOUNDOR_UI_DIR=' + uiDir);
    const native = await readFile(join(uiDir, 'bundle.js'), 'utf8');
    expect(native).toMatch(/require\(["']soundor:host["']\)/);
    expect(native.trim().split('\n')).toHaveLength(1);
    expect(await exists(join(uiDir, 'bundle.js.map'))).toBe(false);
  });

  it('throws an ENV error when JUCE cannot be located', async () => {
    const ctx = makeCtx(); // memory fs, no JUCE
    const run = vi.fn<() => Promise<void>>();
    await expect(juceBuild(config, ctx, { run })).rejects.toMatchObject({
      code: 'ENV',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('throws an ENV error before invoking CMake when no C++ compiler is available', async () => {
    const root = await tempProjectWithJuce();
    const ctx = makeCtx({
      root,
      fs: createNodeFileSystem(root),
      options: { jucePath: join(root, 'JUCE') },
      mode: 'production',
    });
    const run = vi.fn<() => Promise<void>>();
    const probe: CommandProbe = (cmd) => {
      const found = cmd === 'cmake' || cmd === 'ninja';
      return found
        ? { ok: true, version: '1.0' }
        : { ok: false, error: 'not found' };
    };

    await expect(
      juceBuild(config, ctx, { run, probe, platform: 'linux' }),
    ).rejects.toMatchObject({
      code: 'ENV',
      message: expect.stringContaining('No C++ compiler found'),
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('throws an ENV error before invoking CMake when Ninja is missing', async () => {
    const root = await tempProjectWithJuce();
    const ctx = makeCtx({
      root,
      fs: createNodeFileSystem(root),
      options: { jucePath: join(root, 'JUCE') },
      mode: 'production',
    });
    const run = vi.fn<() => Promise<void>>();
    const probe: CommandProbe = (cmd) =>
      cmd === 'ninja' ? { ok: false, error: 'not found' } : okProbe(cmd);

    await expect(juceBuild(config, ctx, { run, probe })).rejects.toMatchObject({
      code: 'ENV',
      message: expect.stringContaining('Ninja not found'),
    });
    expect(run).not.toHaveBeenCalled();
  });
});

describe('build tree', () => {
  const identity = 'Developer ID Application: Acme (ABCDE12345)';

  async function configureArgs(
    phase: 'dev' | 'build',
    platform: NodeJS.Platform,
    extra: { keychain?: string } = {},
  ): Promise<string[]> {
    const root = await tempProjectWithJuce();
    const controller = new AbortController();
    controller.abort();
    const ctx = makeCtx({
      root,
      fs: createNodeFileSystem(root),
      options: { jucePath: join(root, 'JUCE') },
      signal: controller.signal,
      signing: { macos: { identity, source: 'env', ...extra } },
      mode: phase === 'build' ? 'production' : 'debug',
    });
    const calls: string[][] = [];
    const run = async (o: RunCommandOptions) => {
      calls.push([...o.args]);
    };
    const deps = { run, probe: okProbe, platform };
    await (phase === 'dev'
      ? juceDev(config, ctx, deps)
      : juceBuild(config, ctx, deps));
    return calls[0]!;
  }

  it('configures macOS and Linux builds with Ninja', async () => {
    for (const phase of ['dev', 'build'] as const) {
      const args = await configureArgs(phase, 'linux');
      expect(args.slice(args.indexOf('-G'), args.indexOf('-G') + 2)).toEqual([
        '-G',
        'Ninja',
      ]);
    }
  });

  it('signs release builds on macOS with the resolved identity', async () => {
    expect(
      await configureArgs('build', 'darwin', {
        keychain: '/tmp/ci.keychain-db',
      }),
    ).toEqual(
      expect.arrayContaining([
        `-DSOUNDOR_MACOS_SIGNING_IDENTITY=${identity}`,
        '-DSOUNDOR_MACOS_KEYCHAIN=/tmp/ci.keychain-db',
      ]),
    );
  });

  it('signs a one-shot debug build ad-hoc too', async () => {
    const root = await tempProjectWithJuce();
    const ctx = makeCtx({
      root,
      fs: createNodeFileSystem(root),
      options: { jucePath: join(root, 'JUCE') },
      signing: { macos: { identity, source: 'env' } },
      mode: 'debug',
    });
    const calls: string[][] = [];
    await juceBuild(config, ctx, {
      run: async (o: RunCommandOptions) => void calls.push([...o.args]),
      probe: okProbe,
      platform: 'darwin',
    });
    expect(calls[0]).toContain('-DSOUNDOR_MACOS_SIGNING_IDENTITY=-');
  });

  it('signs debug builds ad-hoc', async () => {
    expect(await configureArgs('dev', 'darwin')).toEqual(
      expect.arrayContaining([
        '-DSOUNDOR_MACOS_SIGNING_IDENTITY=-',
        '-DSOUNDOR_MACOS_KEYCHAIN=',
      ]),
    );
  });

  it('passes no signing settings outside macOS', async () => {
    const args = await configureArgs('build', 'linux');
    expect(args.some((arg) => arg.startsWith('-DSOUNDOR_MACOS_'))).toBe(false);
  });

  it('recreates a build tree configured with another generator', async () => {
    const root = await tempProjectWithJuce();
    const ctx = makeCtx({
      root,
      fs: createNodeFileSystem(root),
      options: { jucePath: join(root, 'JUCE') },
      mode: 'production',
    });
    const stale = join(ctx.paths.cache, 'build-release');
    await mkdir(stale, { recursive: true });
    await writeFile(
      join(stale, 'CMakeCache.txt'),
      'CMAKE_GENERATOR:INTERNAL=Unix Makefiles\n',
    );
    await writeFile(join(stale, 'Makefile'), '');

    const run = async () => {};
    const deps = { run, probe: okProbe, platform: 'linux' as const };
    await juceBuild(config, ctx, deps);
    expect(await exists(join(stale, 'Makefile'))).toBe(false);
    expect(await exists(stale)).toBe(true);

    // A Ninja tree is kept.
    await writeFile(
      join(stale, 'CMakeCache.txt'),
      'CMAKE_GENERATOR:INTERNAL=Ninja\n',
    );
    await juceBuild(config, ctx, deps);
    expect(await exists(join(stale, 'CMakeCache.txt'))).toBe(true);
  });

  it('recreates a build tree configured with another JUCE', async () => {
    const root = await tempProjectWithJuce();
    const juce = join(root, 'JUCE');
    const ctx = makeCtx({
      root,
      fs: createNodeFileSystem(root),
      options: { jucePath: juce },
      mode: 'production',
    });
    const stale = join(ctx.paths.cache, 'build-release');
    await mkdir(stale, { recursive: true });
    await writeFile(
      join(stale, 'CMakeCache.txt'),
      'CMAKE_GENERATOR:INTERNAL=Ninja\nJUCE_DIR:UNINITIALIZED=/opt/JUCE\n',
    );
    await writeFile(join(stale, 'build.ninja'), '');
    const info = vi.spyOn(ctx.logger, 'info');

    const run = async () => {};
    const deps = { run, probe: okProbe, platform: 'linux' as const };
    await juceBuild(config, ctx, deps);
    expect(await exists(join(stale, 'build.ninja'))).toBe(false);
    expect(await exists(stale)).toBe(true);
    expect(info).toHaveBeenCalledWith(
      `Recreating ${stale}: it was configured with JUCE at /opt/JUCE, and JUCE is now at ${juce}`,
    );

    // A tree configured with the same JUCE is kept.
    await writeFile(
      join(stale, 'CMakeCache.txt'),
      `CMAKE_GENERATOR:INTERNAL=Ninja\nJUCE_DIR:UNINITIALIZED=${juce}\n`,
    );
    await juceBuild(config, ctx, deps);
    expect(await exists(join(stale, 'CMakeCache.txt'))).toBe(true);
  });

  it("keeps Visual Studio, CMake's default, on Windows", async () => {
    expect((await configureArgs('build', 'win32')).includes('-G')).toBe(false);
  });
});
