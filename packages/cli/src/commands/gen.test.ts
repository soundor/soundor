import {
  mkdir,
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
            { path: 'assets.d.ts', status: 'created' },
            { path: 'env.d.ts', status: 'created' },
            { path: 'globals.d.ts', status: 'created' },
            { path: 'history.d.ts', status: 'created' },
            { path: 'native.d.ts', status: 'created' },
            { path: 'parameters.d.ts', status: 'created' },
            { path: 'platform.d.ts', status: 'created' },
            { path: 'presets.d.ts', status: 'created' },
            // The Rust SDK, with the contract the processing gets.
            { path: 'rust/soundor/Cargo.toml', status: 'created' },
            { path: 'rust/soundor/src/audio.rs', status: 'created' },
            { path: 'rust/soundor/src/compile_tests.rs', status: 'created' },
            { path: 'rust/soundor/src/context.rs', status: 'created' },
            { path: 'rust/soundor/src/controller_ffi.rs', status: 'created' },
            {
              path: 'rust/soundor/src/controller_testing.rs',
              status: 'created',
            },
            { path: 'rust/soundor/src/controller.rs', status: 'created' },
            { path: 'rust/soundor/src/error.rs', status: 'created' },
            { path: 'rust/soundor/src/executor.rs', status: 'created' },
            { path: 'rust/soundor/src/ffi.rs', status: 'created' },
            { path: 'rust/soundor/src/host.rs', status: 'created' },
            { path: 'rust/soundor/src/instance.rs', status: 'created' },
            { path: 'rust/soundor/src/json.rs', status: 'created' },
            { path: 'rust/soundor/src/layout.rs', status: 'created' },
            { path: 'rust/soundor/src/lib.rs', status: 'created' },
            { path: 'rust/soundor/src/plugin.rs', status: 'created' },
            { path: 'rust/soundor/src/processor.rs', status: 'created' },
            { path: 'rust/soundor/src/resources.rs', status: 'created' },
            { path: 'rust/soundor/src/schedule.rs', status: 'created' },
            { path: 'rust/soundor/src/state.rs', status: 'created' },
            { path: 'rust/soundor/src/streams.rs', status: 'created' },
            { path: 'rust/soundor/src/testing.rs', status: 'created' },
            { path: 'rust/soundor/src/transport.rs', status: 'created' },
            { path: 'rust/soundor/src/wasm_controller.rs', status: 'created' },
            { path: 'rust/soundor/src/wasm.rs', status: 'created' },
            { path: 'rust/soundor/src/wire.rs', status: 'created' },
            { path: 'soundor.d.ts', status: 'created' },
            { path: 'state.d.ts', status: 'created' },
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
        join(
          root,
          '.soundor',
          'generated',
          'rust',
          'soundor',
          'src',
          'plugin.rs',
        ),
        'utf8',
      ),
    ).resolves.toContain('pub gain: f32,');
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

  it('creates a new Rust crate and preserves its edits and layout', async () => {
    await writeConfig(root, 'gain');
    await runGen({ cwd: root });
    const processor = join(root, 'native/src/processor.rs');
    const manifest = join(root, 'native/Cargo.toml');
    expect(await readFile(processor, 'utf8')).toContain('impl Processor');
    expect(await readFile(manifest, 'utf8')).toContain('[dependencies]');
    await writeFile(processor, '// custom processor');
    await writeFile(manifest, '# custom dependencies');
    await rm(join(root, 'native/src/controller.rs'));
    await runGen({ cwd: root });
    expect(await readFile(processor, 'utf8')).toBe('// custom processor');
    expect(await readFile(manifest, 'utf8')).toBe('# custom dependencies');
    expect(await pathExists(join(root, 'native/src/controller.rs'))).toBe(
      false,
    );
    expect(await pathExists(join(root, 'runtimes'))).toBe(false);
  });

  it('leaves an existing custom Rust crate untouched', async () => {
    await writeConfig(root, 'gain');
    const native = join(root, 'native');
    await mkdir(join(native, 'src'), { recursive: true });
    await writeFile(
      join(native, 'Cargo.toml'),
      '[package]\nname = "custom-processor"\nversion = "0.1.0"\n\n[lib]\nname = "custom_library"\n',
    );
    await writeFile(join(native, 'src/lib.rs'), '// custom layout');
    const before = await snapshotTree(native);
    await runGen({ cwd: root });
    expect(await snapshotTree(native)).toEqual(before);
    expect(await pathExists(join(root, 'rust-toolchain.toml'))).toBe(false);
    expect(
      await pathExists(
        join(root, '.soundor/generated/rust/soundor/src/plugin.rs'),
      ),
    ).toBe(true);
  });

  it('never creates starter files in check mode', async () => {
    await writeConfig(root, 'gain');
    await expect(runGen({ cwd: root, check: true })).rejects.toThrow(
      /generated/i,
    );
    expect(await pathExists(join(root, 'native'))).toBe(false);
    expect(await pathExists(join(root, 'rust-toolchain.toml'))).toBe(false);
    await runGen({ cwd: root });
    await rm(join(root, 'native'), { recursive: true });
    await rm(join(root, 'rust-toolchain.toml'));
    await runGen({ cwd: root, check: true });
    expect(await pathExists(join(root, 'native'))).toBe(false);
    expect(await pathExists(join(root, 'rust-toolchain.toml'))).toBe(false);
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
      changes: [
        { path: 'parameters.d.ts', kind: 'stale' },
        { path: 'rust/soundor/src/plugin.rs', kind: 'stale' },
      ],
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
  parameters: {
    '${parameterId}': {
      type: 'float32',
      label: '${parameterId}',
      min: 0,
      max: 1,
      default: 0.5,
    },
  },
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
  parameters: {},
  plugin: { id: 'com.example.test', name: 'Test' },
});
`,
    'utf8',
  );
}
