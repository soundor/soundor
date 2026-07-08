import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createNodeFileSystem,
  type RunCommandOptions,
  type SoundorConfig,
} from '@soundor/runtime-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { juceBuild, juceDev, juceGen, juceInit } from './index';
import { makeCtx } from './testing';

const config = {
  runtimes: [],
  parameters: [
    { type: 'float', id: 'gain', label: 'Gain', min: 0, max: 1, default: 0.5 },
  ],
  nativeMethods: [],
} as unknown as SoundorConfig;

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
    ]);
  });
});

describe('juceDev', () => {
  it('configures a debug build pointed at the Vite dev URL', async () => {
    const root = await tempProjectWithJuce();
    const controller = new AbortController();
    controller.abort(); // dev returns as soon as the (already-aborted) signal fires.
    const ctx = makeCtx({
      root,
      fs: createNodeFileSystem(root),
      options: { jucePath: join(root, 'JUCE') },
      dev: { ui: { kind: 'vite', url: 'http://localhost:5173/' } },
      signal: controller.signal,
    });
    const calls: string[][] = [];
    const run = (o: RunCommandOptions) => {
      calls.push([o.cmd, ...o.args]);
      return Promise.resolve();
    };

    await juceDev(config, ctx, { run });

    const configure = calls[0]!;
    expect(configure).toContain('-DJUCE_DIR=' + join(root, 'JUCE'));
    expect(configure).toContain('-DSOUNDOR_DEV_URL=http://localhost:5173/');
    expect(calls.some((c) => c.includes('--build'))).toBe(true);
  });
});

describe('juceBuild', () => {
  it('builds Release, passes the UI bundle, and collects artefacts into dist', async () => {
    const root = await tempProjectWithJuce();
    const ctx = makeCtx({
      root,
      fs: createNodeFileSystem(root),
      options: { jucePath: join(root, 'JUCE') },
      mode: 'production',
      build: { ui: { kind: 'vite', dir: join(root, 'ui') } },
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

    await juceBuild(config, ctx, { run });

    expect(calls[0]).toContain('-DJUCE_DIR=' + join(root, 'JUCE'));
    expect(calls[0]).toContain('-DSOUNDOR_UI_DIR=' + join(root, 'ui'));
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
});
