import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ArgsDef, CommandMeta } from 'citty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BuildFailedError, buildCommand, runBuild } from './build';

vi.mock('@clack/prompts', () => ({
  outro: vi.fn<() => void>(),
  spinner: vi.fn<() => { start: () => void; stop: (msg?: string) => void }>(
    () => ({
      start: vi.fn<() => void>(),
      stop: vi.fn<() => void>(),
    }),
  ),
}));

describe('build command', () => {
  it('is defined', () => {
    expect(buildCommand).toBeDefined();
  });

  it('has correct meta', () => {
    expect((buildCommand.meta as CommandMeta)?.name).toBe('build');
  });

  it('declares runtime as an optional positional arg', () => {
    const args = buildCommand.args as ArgsDef;
    expect(args['runtime']).toMatchObject({
      type: 'positional',
      required: false,
    });
  });
});

describe('runBuild', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'soundor-cli-build-'));
    globalThis.__soundorBuildEvents = [];
  });

  afterEach(async () => {
    delete globalThis.__soundorBuildEvents;
    delete globalThis.__soundorBuildUi;
    await rm(root, { recursive: true, force: true });
  });

  it('bundles the UI and hands it to the runtime', async () => {
    await writeConfig(root, ['alpha']);
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(
      join(root, 'src', 'main.ts'),
      "import { plugin } from 'soundor:host';\nconsole.info(plugin.name);\n",
    );
    await runBuild({ cwd: root });
    const ui = globalThis.__soundorBuildUi as
      | { dir: string; entry: string }
      | undefined;
    expect(ui).toEqual({
      dir: join(root, '.soundor', 'ui', 'production'),
      entry: 'bundle.js',
    });
    const bundle = await readFile(join(ui!.dir, 'bundle.js'), 'utf8');
    expect(bundle).toMatch(/from\s*["']soundor:host["']/);
  });

  it('passes no UI when the project has no entry', async () => {
    await writeConfig(root, ['alpha']);
    await runBuild({ cwd: root });
    expect(globalThis.__soundorBuildUi).toBeUndefined();
  });

  it('builds all configured runtimes in production mode', async () => {
    await writeConfig(root, ['alpha', 'beta']);

    await expect(runBuild({ cwd: root })).resolves.toEqual({
      runtimes: [
        { runtime: 'alpha', status: 'built' },
        { runtime: 'beta', status: 'built' },
      ],
    });

    expect(globalThis.__soundorBuildEvents).toEqual([
      'gen:alpha:production',
      'gen:beta:production',
      'build:alpha:production',
      'build:beta:production',
    ]);
    await expect(
      readFile(join(root, '.soundor', 'dist', 'alpha', 'artifact.txt'), 'utf8'),
    ).resolves.toBe('alpha:production\n');
    await expect(
      readFile(join(root, '.soundor', 'dist', 'beta', 'artifact.txt'), 'utf8'),
    ).resolves.toBe('beta:production\n');
  });

  it('builds only the named runtime', async () => {
    await writeConfig(root, ['alpha', 'beta']);

    await expect(runBuild({ cwd: root, runtime: 'beta' })).resolves.toEqual({
      runtimes: [{ runtime: 'beta', status: 'built' }],
    });

    expect(globalThis.__soundorBuildEvents).toEqual([
      'gen:beta:production',
      'build:beta:production',
    ]);
    await expect(
      readFile(join(root, '.soundor', 'dist', 'beta', 'artifact.txt'), 'utf8'),
    ).resolves.toBe('beta:production\n');
  });

  it('aggregates failures and fails the build after remaining runtimes run', async () => {
    await writeConfig(root, ['alpha', 'beta', 'gamma'], { fail: 'beta' });

    const error = (await runBuild({ cwd: root }).catch(
      (caught: unknown) => caught,
    )) as BuildFailedError;

    expect(error).toBeInstanceOf(BuildFailedError);
    expect(error.exitCode).toBe(5);
    expect(error.results).toMatchObject([
      { runtime: 'alpha', status: 'built' },
      { runtime: 'beta', status: 'failed' },
      { runtime: 'gamma', status: 'built' },
    ]);
    expect(error.message).toContain('Build summary');
    expect(globalThis.__soundorBuildEvents).toEqual([
      'gen:alpha:production',
      'gen:beta:production',
      'gen:gamma:production',
      'build:alpha:production',
      'build:beta:production',
      'build:gamma:production',
    ]);
  });
});

declare global {
  // eslint-disable-next-line no-var
  var __soundorBuildEvents: string[] | undefined;
  // eslint-disable-next-line no-var
  var __soundorBuildUi: unknown;
}

async function writeConfig(
  root: string,
  runtimeIds: readonly string[],
  options: { fail?: string } = {},
): Promise<void> {
  await writeFile(
    join(root, 'soundor.config.ts'),
    `import { defineSoundorConfig } from '@soundor/config';

function runtime(id) {
  return {
    id,
    async init() {},
    async gen(_config, ctx) {
      globalThis.__soundorBuildEvents.push('gen:' + id + ':' + ctx.mode);
      ctx.codegen.emit({ path: 'runtime.txt', contents: id + ':' + ctx.mode + '\\n' });
    },
    async dev() {},
    async build(_config, ctx) {
      globalThis.__soundorBuildEvents.push('build:' + id + ':' + ctx.mode);
      if (id === ${JSON.stringify(options.fail)}) throw new Error('build failed for ' + id);
      globalThis.__soundorBuildUi = ctx.ui;
      await ctx.fs.write(ctx.paths.dist + '/artifact.txt', id + ':' + ctx.mode + '\\n');
    },
    async doctor() {
      return { checks: [] };
    },
  };
}

export default defineSoundorConfig({
  runtimes: [${runtimeIds
    .map(
      (id) =>
        `{ id: ${JSON.stringify(id)}, options: {}, runtime: runtime(${JSON.stringify(id)}) }`,
    )
    .join(', ')}],
  parameters: [],
  plugin: { id: 'com.example.test', name: 'Test' },
});
`,
    'utf8',
  );
}
