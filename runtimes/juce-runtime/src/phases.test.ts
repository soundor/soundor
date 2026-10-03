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
  type RunCommandOptions,
  type SoundorConfig,
} from '@soundor/runtime-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { juceBuild, juceDev, juceGen, juceInit } from './index';
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
    expect(configure.some((arg) => arg.startsWith('-DSOUNDOR_'))).toBe(false);
    expect(calls.some((c) => c.includes('--build'))).toBe(true);
  });

  it('launches the standalone debug app when standalone is configured', async () => {
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
        'Standalone',
        'Soundor Basic',
      ),
    ]);
  });
});

describe('juceBuild', () => {
  it('builds Release and collects artefacts into dist', async () => {
    const root = await tempProjectWithJuce();
    const ctx = makeCtx({
      root,
      fs: createNodeFileSystem(root),
      options: { jucePath: join(root, 'JUCE') },
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
    const copied = join(
      ctx.paths.dist,
      'Plugin_artefacts',
      'Release',
      'Plugin.vst3',
    );
    expect(await exists(copied)).toBe(true);
    expect(await readFile(copied, 'utf8')).toBe('binary');
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
    const probe: CommandProbe = (cmd) => ({
      ok: cmd === 'cmake',
      version: cmd === 'cmake' ? 'cmake 3.22' : undefined,
      error: cmd === 'cmake' ? undefined : 'not found',
    });

    await expect(juceBuild(config, ctx, { run, probe })).rejects.toMatchObject({
      code: 'ENV',
      message: expect.stringContaining('No C++ compiler found'),
    });
    expect(run).not.toHaveBeenCalled();
  });
});
