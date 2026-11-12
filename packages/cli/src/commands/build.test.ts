import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RUNTIME_API_VERSION } from '@soundor/config';
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
      | { dir: string; module: string }
      | undefined;
    expect(ui).toEqual({
      dir: join(root, '.soundor', 'ui', 'production'),
      module: 'bundle.mjs',
    });
    const module = await readFile(join(ui!.dir, 'bundle.mjs'), 'utf8');
    expect(module).toMatch(/from\s*["']soundor:host["']/);
  });

  describe('--debug and --out', () => {
    it('builds one runtime in debug mode, away from releases', async () => {
      await writeConfig(root, ['alpha', 'beta'], { devtools: true });
      await runBuild({ cwd: root, runtime: 'alpha', debug: true });
      expect(globalThis.__soundorBuildEvents).toEqual([
        'gen:alpha:debug',
        'build:alpha:debug',
      ]);
      expect(
        await readFile(
          join(root, '.soundor', 'debug', 'alpha', 'artifact.txt'),
          'utf8',
        ),
      ).toBe('alpha:debug\n');
      await expect(
        readFile(join(root, '.soundor', 'dist', 'alpha', 'artifact.txt')),
      ).rejects.toThrow();
    });

    it('bundles the UI apart from soundor dev', async () => {
      await writeConfig(root, ['alpha'], { devtools: true });
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(
        join(root, 'src', 'main.ts'),
        "import { plugin } from 'soundor:host';\nconsole.info(plugin.name);\n",
      );
      await runBuild({ cwd: root, runtime: 'alpha', debug: true });
      expect(globalThis.__soundorBuildUi).toEqual({
        dir: join(root, '.soundor', 'ui', 'debug-build'),
        module: 'bundle.mjs',
      });
    });

    it('refuses a runtime without DevTools, building nothing', async () => {
      await writeConfig(root, ['alpha']);
      await expect(
        runBuild({ cwd: root, runtime: 'alpha', debug: true }),
      ).rejects.toThrow('The alpha runtime has no debug build');
      expect(globalThis.__soundorBuildEvents).toEqual([]);
    });

    it('needs a runtime', async () => {
      await writeConfig(root, ['alpha'], { devtools: true });
      await expect(runBuild({ cwd: root, debug: true })).rejects.toThrow(
        '--debug needs a runtime',
      );
      await expect(runBuild({ cwd: root, out: 'build' })).rejects.toThrow(
        '--out needs a runtime',
      );
      expect(globalThis.__soundorBuildEvents).toEqual([]);
    });

    it('writes where --out says, from the working directory', async () => {
      await writeConfig(root, ['alpha'], { devtools: true });
      await mkdir(join(root, 'e2e'));
      const cwd = join(root, 'e2e');
      await runBuild({
        cwd,
        configPath: join(root, 'soundor.config.ts'),
        runtime: 'alpha',
        debug: true,
        out: 'build',
      });
      expect(await readFile(join(cwd, 'build', 'artifact.txt'), 'utf8')).toBe(
        'alpha:debug\n',
      );
    });

    it('sends a release there too', async () => {
      await writeConfig(root, ['alpha']);
      await runBuild({ cwd: root, runtime: 'alpha', out: 'release' });
      expect(
        await readFile(join(root, 'release', 'artifact.txt'), 'utf8'),
      ).toBe('alpha:production\n');
    });
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

  it('refuses an incompatible runtime before generating or bundling', async () => {
    await writeConfig(root, ['alpha', 'beta'], { incompatible: 'beta' });
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'main.ts'), 'console.info(1);\n');

    const error = await runBuild({ cwd: root }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({
      code: 'INCOMPATIBLE_RUNTIME',
      runtimeId: 'beta',
    });
    expect(globalThis.__soundorBuildEvents).toEqual([]);
    await expect(readdir(root)).resolves.not.toContain('.soundor');
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
  options: { fail?: string; devtools?: boolean; incompatible?: string } = {},
): Promise<void> {
  await writeFile(
    join(root, 'soundor.config.ts'),
    `import { defineSoundorConfig } from '@soundor/config';

function runtime(id) {
  return {
    id,
    ${options.devtools ? 'capabilities: { devtools: { inspector: true } },' : ''}
    apiVersion: id === ${JSON.stringify(options.incompatible)} ? 999 : ${RUNTIME_API_VERSION},
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
  parameters: {},
  plugin: { id: 'com.example.test', name: 'Test' },
});
`,
    'utf8',
  );
}
