import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigError } from '@soundor/config';
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

    const report = await runGen({ cwd: root });

    expect(report).toMatchObject({
      mode: 'write',
      groups: [
        {
          name: 'core',
          files: [
            { path: 'native.d.ts', status: 'created' },
            { path: 'parameters.d.ts', status: 'created' },
            { path: 'platform.d.ts', status: 'created' },
            { path: 'soundor.d.ts', status: 'created' },
          ],
        },
        {
          name: 'runtime:test',
          files: [{ path: 'runtime.txt', status: 'created' }],
        },
      ],
    });
    await expect(
      readFile(join(root, '.soundor', 'generated', 'parameters.d.ts'), 'utf8'),
    ).resolves.toContain('readonly gain: Parameter<number,');
    await expect(
      readFile(
        join(root, '.soundor', 'generated', 'runtimes', 'test', 'runtime.txt'),
        'utf8',
      ),
    ).resolves.toBe('["gain"]\n');
    await expect(runGen({ cwd: root, check: true })).resolves.toMatchObject({
      mode: 'check',
      groups: [
        { name: 'core' },
        {
          name: 'runtime:test',
          files: [{ path: 'runtime.txt', status: 'up-to-date' }],
        },
      ],
    });
  });

  it('is idempotent across repeated generation', async () => {
    await writeConfig(root, 'gain');

    await runGen({ cwd: root });
    const first = await snapshotTree(join(root, '.soundor'));
    const report = await runGen({ cwd: root });
    const second = await snapshotTree(join(root, '.soundor'));

    expect(second).toEqual(first);
    expect(report.groups.flatMap((group) => group.files)).toEqual(
      expect.arrayContaining([
        { path: 'parameters.d.ts', status: 'unchanged' },
        { path: 'native.d.ts', status: 'unchanged' },
        { path: 'runtime.txt', status: 'unchanged' },
      ]),
    );
  });

  it('fails check mode when generated files are stale', async () => {
    await writeConfig(root, 'gain');
    await runGen({ cwd: root });

    await writeConfig(root, 'drive');

    await expect(runGen({ cwd: root, check: true })).rejects.toMatchObject({
      changes: [{ path: 'parameters.d.ts', kind: 'stale' }],
    });
  });

  it('fails check mode when runtime generated files are stale', async () => {
    await writeConfig(root, 'gain');
    await runGen({ cwd: root });

    await writeFile(
      join(root, '.soundor', 'generated', 'runtimes', 'test', 'runtime.txt'),
      'stale\n',
      'utf8',
    );

    await expect(runGen({ cwd: root, check: true })).rejects.toMatchObject({
      changes: [{ path: 'runtime.txt', kind: 'stale' }],
    });
  });

  it('aborts invalid config before writing generated files', async () => {
    await writeInvalidConfig(root);

    await expect(runGen({ cwd: root })).rejects.toBeInstanceOf(ConfigError);
    await expect(pathExists(join(root, '.soundor'))).resolves.toBe(false);
  });
});

interface SnapshotEntry {
  path: string;
  contents: string;
}

async function snapshotTree(
  dir: string,
  prefix = '',
): Promise<SnapshotEntry[]> {
  const entries: SnapshotEntry[] = [];
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    const relative = prefix === '' ? name : join(prefix, name);
    if ((await stat(path)).isDirectory()) {
      entries.push(...(await snapshotTree(path, relative)));
    } else {
      entries.push({ path: relative, contents: await readFile(path, 'utf8') });
    }
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

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
  plugin: { id: 'com.example.test', name: 'Test' },
});
`,
    'utf8',
  );
}

async function writeInvalidConfig(root: string): Promise<void> {
  await writeFile(
    join(root, 'soundor.config.ts'),
    `import { defineSoundorConfig } from '@soundor/config';

export default defineSoundorConfig({
  runtimes: [{ id: 'test' }],
  parameters: [],
  plugin: { id: 'com.example.test', name: 'Test' },
});
`,
    'utf8',
  );
}
