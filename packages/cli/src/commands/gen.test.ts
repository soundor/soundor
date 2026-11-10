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

  it('refuses an incompatible runtime before generating anything', async () => {
    await writeIncompatibleConfig(root);

    const error = await runGen({ cwd: root }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({
      name: 'RuntimeCompatibilityError',
      code: 'INCOMPATIBLE_RUNTIME',
      runtimeId: 'old',
    });
    expect((error as { format(): string }).format()).toContain(
      "Runtime 'old' (soundor-runtime-old@1.0.0) does not support this project's Soundor version.",
    );
    // Neither the portable files nor the compatible runtime's were written.
    await expect(readdir(root)).resolves.toEqual(['soundor.config.ts']);
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
            { path: 'assets.d.ts', status: 'created' },
            { path: 'globals.d.ts', status: 'created' },
            { path: 'native.d.ts', status: 'created' },
            { path: 'parameters.d.ts', status: 'created' },
            { path: 'platform.d.ts', status: 'created' },
            { path: 'soundor.d.ts', status: 'created' },
            { path: 'ui.d.ts', status: 'created' },
            { path: 'webgl.d.ts', status: 'created' },
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

/**
 * A config with two runtimes: `good`, which supports any host, and `old`, which
 * supports only @soundor/config 0.0.x.
 */
async function writeIncompatibleConfig(root: string): Promise<void> {
  const runtime = (id: string, config: string) => `{
  id: '${id}',
  package: {
    name: 'soundor-runtime-${id}',
    version: '1.0.0',
    compatibility: { config: '${config}', core: '>=0.0.0', schemas: [1] },
  },
  async init() {},
  async gen(_config, ctx) {
    ctx.codegen.emit({ path: '${id}.txt', contents: '${id}\\n' });
  },
  async dev() {},
  async build() {},
  async doctor() {
    return { checks: [] };
  },
}`;
  await writeFile(
    join(root, 'soundor.config.ts'),
    `import { defineSoundorConfig } from '@soundor/config';

const good = ${runtime('good', '>=0.0.0')};
const old = ${runtime('old', '>=0.0.0 <0.1.0')};

export default defineSoundorConfig({
  runtimes: [
    { id: 'good', options: {}, runtime: good },
    { id: 'old', options: {}, runtime: old },
  ],
  parameters: [],
  plugin: { id: 'com.example.test', name: 'Test' },
});
`,
    'utf8',
  );
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
