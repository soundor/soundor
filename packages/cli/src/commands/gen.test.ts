import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CommandMeta } from 'citty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { genCommand, runGen } from './gen';

vi.mock('@clack/prompts', () => ({
  outro: vi.fn<() => void>(),
  spinner: vi.fn<() => { start: () => void; stop: (msg?: string) => void }>(
    () => ({
      start: vi.fn<() => void>(),
      stop: vi.fn<() => void>(),
    }),
  ),
}));

describe('gen command', () => {
  it('is defined', () => {
    expect(genCommand).toBeDefined();
  });

  it('has correct meta', () => {
    expect((genCommand.meta as CommandMeta)?.name).toBe('gen');
  });
});

describe('runGen', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'soundor-cli-gen-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes portable and runtime generated files, then passes check mode', async () => {
    await writeConfig(root, 'gain');

    await runGen({ cwd: root });

    await expect(
      readFile(join(root, '.soundor', 'generated', 'parameters.ts'), 'utf8'),
    ).resolves.toContain('gain: number;');
    await expect(
      readFile(join(root, '.soundor', 'gen', 'test', 'runtime.txt'), 'utf8'),
    ).resolves.toBe('["gain"]\n');
    await expect(runGen({ cwd: root, check: true })).resolves.toBeUndefined();
  });

  it('fails check mode when generated files are stale', async () => {
    await writeConfig(root, 'gain');
    await runGen({ cwd: root });

    await writeConfig(root, 'drive');

    await expect(runGen({ cwd: root, check: true })).rejects.toMatchObject({
      changes: [
        { path: 'parameters.json', kind: 'stale' },
        { path: 'parameters.ts', kind: 'stale' },
      ],
    });
  });
});

async function writeConfig(root: string, parameterId: string): Promise<void> {
  await writeFile(
    join(root, 'soundor.config.ts'),
    `import { defineSoundorConfig } from '@soundor/config';

const runtime = {
  id: 'test',
  async init() {},
  async gen(config, ctx) {
    ctx.codegen.emit({
      path: 'runtime.txt',
      contents: JSON.stringify(config.parameters.map((parameter) => parameter.id)) + '\\n',
    });
  },
  async dev() {},
  async build() {},
  async doctor() {
    return { checks: [] };
  },
};

export default defineSoundorConfig({
  runtimes: [{ id: 'test', options: {}, runtime }],
  parameters: [
    {
      type: 'float',
      id: '${parameterId}',
      label: '${parameterId}',
      min: 0,
      max: 1,
      default: 0.5,
    },
  ],
  nativeMethods: [],
});
`,
    'utf8',
  );
}
