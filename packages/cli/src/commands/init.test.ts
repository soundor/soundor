import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ArgsDef, CommandMeta } from 'citty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initCommand, runInit } from './init';

vi.mock('@clack/prompts', () => ({
  outro: vi.fn<() => void>(),
  spinner: vi.fn<() => { start: () => void; stop: (msg?: string) => void }>(
    () => ({
      start: vi.fn<() => void>(),
      stop: vi.fn<() => void>(),
    }),
  ),
}));

describe('init command', () => {
  it('is defined', () => {
    expect(initCommand).toBeDefined();
  });

  it('has correct meta', () => {
    expect((initCommand.meta as CommandMeta)?.name).toBe('init');
  });

  it('declares optional runtime and config args', () => {
    const args = initCommand.args as ArgsDef;
    expect(args['runtime']).toMatchObject({
      type: 'positional',
      required: false,
    });
    expect(args['config']).toMatchObject({ type: 'string' });
  });
});

describe('runInit', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'soundor-cli-init-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('runs init for every configured runtime', async () => {
    await writeConfig(root, ['alpha', 'beta']);

    const result = await runInit({ cwd: root });

    expect(result.initialized).toEqual(['alpha', 'beta']);
    await expect(readFile(join(root, 'init-alpha.txt'), 'utf8')).resolves.toBe(
      'alpha:init\n',
    );
    await expect(readFile(join(root, 'init-beta.txt'), 'utf8')).resolves.toBe(
      'beta:init\n',
    );
  });

  it('runs init only for the selected runtime', async () => {
    await writeConfig(root, ['alpha', 'beta']);

    const result = await runInit({ cwd: root, runtime: 'beta' });

    expect(result.initialized).toEqual(['beta']);
    await expect(readFile(join(root, 'init-beta.txt'), 'utf8')).resolves.toBe(
      'beta:init\n',
    );
    await expect(
      readFile(join(root, 'init-alpha.txt'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails clearly when the selected runtime is not configured', async () => {
    await writeConfig(root, ['alpha']);

    await expect(runInit({ cwd: root, runtime: 'missing' })).rejects.toThrow(
      "No runtime registered for id 'missing'.",
    );
  });
});

async function writeConfig(root: string, runtimeIds: string[]): Promise<void> {
  await writeFile(
    join(root, 'soundor.config.ts'),
    `import { defineSoundorConfig } from '@soundor/config';

function makeRuntime(id) {
  return {
    id,
    async init(_config, ctx) {
      await ctx.fs.write(` +
      '`init-${id}.txt`, `${id}:${ctx.phase}\n`' +
      `);
    },
    async gen() {},
    async dev() {},
    async build() {},
    async doctor() {
      return { checks: [] };
    },
  };
}

const runtimes = ${JSON.stringify(runtimeIds)}.map((id) => ({
  id,
  options: {},
  runtime: makeRuntime(id),
}));

export default defineSoundorConfig({
  runtimes,
  parameters: [],
  plugin: { id: 'com.example.test', name: 'Test' },
});
`,
    'utf8',
  );
}
