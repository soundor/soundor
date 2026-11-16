import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { parseConfig } from '@soundor/config';
import { createConsoleLogger } from '@soundor/core';
import { afterEach, describe, expect, it } from 'vitest';

import { checkRust } from '../doctor/env';
import { cliVersion } from '../version';
import {
  buildNativeLibrary,
  cargoArguments,
  nativeCrateContext,
  type SpawnCargo,
} from './cargo';
import { renderPluginRs, rustField } from './codegen';
import { crateName, nativeScaffoldFiles } from './scaffold';
import { rustSdkFiles, sdkSourceDir } from './sdk';

const FIXTURE = resolve(__dirname, '../../rust/fixture/soundor.config.ts');
const GOLDEN = resolve(__dirname, '../../rust/soundor/src/plugin.rs');

const temporary: string[] = [];
afterEach(async () => {
  for (const dir of temporary.splice(0))
    await rm(dir, { recursive: true, force: true });
});

async function project(config: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'soundor-native-'));
  temporary.push(dir);
  await writeFile(join(dir, 'soundor.config.ts'), config);
  return dir;
}

describe('the generated Rust contract', () => {
  it('is the SDK fixture its own tests compile against', async () => {
    const generated = renderPluginRs(await parseConfig({ path: FIXTURE }));
    // UPDATE_GOLDEN=1 rewrites it; the SDK's cargo tests check it compiles.
    if (process.env['UPDATE_GOLDEN'] === '1')
      await writeFile(GOLDEN, generated);
    expect(generated).toBe(await readFile(GOLDEN, 'utf8'));
  });

  it('names fields as Rust does, and escapes keywords', () => {
    expect(rustField('gain')).toBe('gain');
    expect(rustField('sideChainGain')).toBe('side_chain_gain');
    expect(rustField('HPFCutoff')).toBe('hpf_cutoff');
    expect(rustField('type')).toBe('r#type');
    expect(rustField('self')).toBe('self_');
  });

  it('refuses parameters that would be the same field', async () => {
    const dir = await project(`export default {
      plugin: { id: 'dev.soundor.clash', name: 'Clash' },
      runtimes: [],
      parameters: {
        lowCut: { type: 'boolean', default: false },
        low_cut: { type: 'boolean', default: false },
      },
    };`);
    const config = await parseConfig({ path: join(dir, 'soundor.config.ts') });
    expect(() => renderPluginRs(config)).toThrow(
      /parameters.lowCut and parameters.low_cut are both a Rust field named low_cut/,
    );
  });

  it('types a config without parameters, streams or audio', async () => {
    const dir = await project(`export default {
      plugin: { id: 'dev.soundor.empty', name: 'Empty' },
      runtimes: [],
    };`);
    const source = renderPluginRs(
      await parseConfig({ path: join(dir, 'soundor.config.ts') }),
    );
    expect(source).toContain('pub const PARAMETER_IDS: &[&str] = &[];');
    expect(source).toContain('pub const LAYOUTS: &[Layout] = &[];');
    expect(source).toContain('pub const DEFAULT_INPUTS: &[usize] = &[2];');
  });
});

describe('the SDK a project gets', () => {
  it('is the shipped sources at the CLI version, with its plugin.rs', async () => {
    const config = await parseConfig({ path: FIXTURE });
    const files = rustSdkFiles(config);
    const paths = files.map((file) => file.path);
    expect(paths).toContain('rust/soundor/Cargo.toml');
    expect(paths).toContain('rust/soundor/src/lib.rs');
    expect(paths).toContain('rust/soundor/src/ffi.rs');
    expect(paths).toContain('rust/soundor/src/testing.rs');
    expect(paths.filter((path) => path.endsWith('plugin.rs'))).toEqual([
      'rust/soundor/src/plugin.rs',
    ]);
    expect(paths.some((path) => path.includes('/tests/'))).toBe(false);
    const manifest = files.find((file) => file.path.endsWith('Cargo.toml'))!;
    expect(manifest.contents).toContain(`version = "${cliVersion()}"`);
    expect(sdkSourceDir()).toBe(resolve(__dirname, '../../rust/soundor'));
  });

  it('is in the package npm publishes', async () => {
    const pkg = JSON.parse(
      await readFile(resolve(__dirname, '../../package.json'), 'utf8'),
    ) as { files: string[] };
    expect(pkg.files).toEqual(
      expect.arrayContaining(['rust/soundor/Cargo.toml', 'rust/soundor/src']),
    );
  });
});

describe('the native scaffold', () => {
  it('is a crate that depends on the generated SDK', async () => {
    const config = await parseConfig({ path: FIXTURE });
    const files = nativeScaffoldFiles(config);
    expect(files.map((file) => file.path)).toEqual([
      'rust-toolchain.toml',
      'native/Cargo.toml',
      'native/.gitignore',
      'native/src/lib.rs',
      // The fixture declares native methods: a controller for them.
      'native/src/controller.rs',
      'native/src/processor.rs',
      'native/tests/controller.rs',
      'native/tests/processor.rs',
      'native/tests/realtime.rs',
    ]);
    const manifest = files[1]!.contents;
    expect(manifest).toContain('name = "sdk-fixture"');
    expect(manifest).toContain(
      'soundor = { path = "../.soundor/generated/rust/soundor" }',
    );
    expect(files[0]!.contents).toContain('channel = "stable"');
    expect(files[3]!.contents).toContain(
      'soundor::export!(PluginProcessor, PluginController);',
    );
    expect(files[5]!.contents).toContain('impl Processor for PluginProcessor');
    expect(files[5]!.contents).toContain('ctx.params.gain');
    const controller = files[4]!.contents;
    expect(controller).toContain('impl NativeMethods for PluginController');
    expect(controller).toContain(
      '    fn increment(_ctx: &mut TaskContext<Self>) -> i32 {',
    );
    expect(controller).toContain(
      '    async fn load_table(_ctx: AsyncTaskContext<Self>, _length: u32) -> Result<Vec<f32>, Error> {',
    );
    expect(controller).toContain(
      '    fn reset(_ctx: &mut TaskContext<Self>) {\n        // TODO: implement it.\n    }',
    );
    expect(files[6]!.contents).toContain('TestController::<PluginController>');
    expect(files[7]!.contents).toContain('use sdk_fixture::PluginProcessor;');
    expect(files[8]!.contents).toContain(
      'static ALLOCATOR: CountingAllocator = CountingAllocator;',
    );
    expect(files[8]!.contents).toContain('use sdk_fixture::PluginProcessor;');
  });

  it('requires a controller without methods and uses the blanket NativeMethods implementation', async () => {
    const config = await parseConfig({ path: FIXTURE });
    const files = nativeScaffoldFiles({
      ...config,
      native: { ...config.native, methods: {} },
    });
    expect(files.map((file) => file.path)).toContain(
      'native/src/controller.rs',
    );
    expect(files[3]!.contents).toContain(
      'soundor::export!(PluginProcessor, PluginController);',
    );
    expect(files[4]!.contents).not.toContain('impl NativeMethods');
  });

  it('compiles unedited controller scaffolds with and without methods for native and WASM', async () => {
    const fixture = await parseConfig({ path: FIXTURE });
    for (const declaredMethods of [true, false]) {
      const config = declaredMethods
        ? fixture
        : { ...fixture, native: { ...fixture.native, methods: {} } };
      const root = await mkdtemp(
        join(tmpdir(), 'soundor-controller-scaffold-'),
      );
      temporary.push(root);
      const files = [
        ...nativeScaffoldFiles(config),
        ...rustSdkFiles(config).map((file) => ({
          ...file,
          path: `.soundor/generated/${file.path}`,
        })),
      ];
      for (const file of files) {
        const target = join(root, file.path);
        await mkdir(join(target, '..'), { recursive: true });
        await writeFile(target, file.contents);
      }
      for (const args of [
        ['test', '--manifest-path', 'native/Cargo.toml'],
        [
          'rustc',
          '--manifest-path',
          'native/Cargo.toml',
          '--lib',
          '--crate-type',
          'cdylib',
          '--target',
          'wasm32-unknown-unknown',
        ],
      ]) {
        const result = spawnSync('cargo', args, {
          cwd: root,
          encoding: 'utf8',
        });
        expect({
          status: result.status,
          error: result.error?.message,
          stderr: result.stderr,
        }).toMatchObject({ status: 0, error: undefined });
      }
    }
  }, 120_000);

  it('derives a crate name from any plugin name', () => {
    expect(crateName('Soundor Basic')).toBe('soundor-basic');
    expect(crateName('OrbitDelay')).toBe('orbit-delay');
    expect(crateName('3 Band')).toBe('plugin-3-band');
    expect(crateName('---')).toBe('plugin');
  });
});

describe('Cargo', () => {
  it('builds the crate type and target asked for, in the project cache', () => {
    const { args, targetDir } = cargoArguments(
      '/p',
      '/p/native/Cargo.toml',
      { crateType: 'staticlib', profile: 'release' },
      'x86_64-unknown-linux-gnu',
    );
    expect(targetDir).toBe(join('/p', '.soundor', 'cache', 'native', 'target'));
    expect(args).toEqual([
      'rustc',
      '--manifest-path',
      '/p/native/Cargo.toml',
      '--lib',
      '--crate-type',
      'staticlib',
      '--target',
      'x86_64-unknown-linux-gnu',
      '--target-dir',
      targetDir,
      '--message-format=json-render-diagnostics',
      '--release',
    ]);
  });

  it('links the C runtime statically for MSVC, in a directory of its own', () => {
    const { args, targetDir } = cargoArguments(
      'C:/p',
      'C:/p/native/Cargo.toml',
      { crateType: 'staticlib', profile: 'debug', staticCrt: true },
      'x86_64-pc-windows-msvc',
    );
    expect(targetDir).toMatch(/target-crt-static$/);
    expect(args).toContain(
      'target.x86_64-pc-windows-msvc.rustflags=["-C", "target-feature=+crt-static"]',
    );
    expect(args).not.toContain('--release');
    const gnu = cargoArguments(
      '/p',
      '/p/native/Cargo.toml',
      { crateType: 'staticlib', profile: 'debug', staticCrt: true },
      'x86_64-unknown-linux-gnu',
    );
    expect(gnu.args).not.toContain('--config');
  });

  it("finds the crate's library among Cargo's artifacts", async () => {
    const root = await project('export default {};');
    const manifest = join(root, 'native', 'Cargo.toml');
    const spawn: SpawnCargo = async (_, { onStdout }) => {
      onStdout(
        JSON.stringify({
          reason: 'compiler-artifact',
          package_id: 'dependency',
          manifest_path: '/elsewhere/Cargo.toml',
          target: { kind: ['staticlib'] },
          filenames: ['/elsewhere/libdependency.a'],
        }),
      );
      onStdout(
        JSON.stringify({
          reason: 'compiler-artifact',
          package_id: 'plugin',
          manifest_path: manifest,
          target: { kind: ['staticlib'] },
          filenames: ['/t/libplugin.a'],
        }),
      );
      onStdout('not json');
      return 0;
    };
    const library = await buildNativeLibrary({
      root,
      manifest,
      request: { crateType: 'staticlib', profile: 'debug' },
      logger: createConsoleLogger('test'),
      spawn,
      host: () => 'x86_64-unknown-linux-gnu',
    });
    expect(library).toEqual({
      path: '/t/libplugin.a',
      target: 'x86_64-unknown-linux-gnu',
    });
  });

  it('fails with what Cargo reported', async () => {
    const root = await project('export default {};');
    await expect(
      buildNativeLibrary({
        root,
        manifest: join(root, 'native', 'Cargo.toml'),
        request: {
          crateType: 'cdylib',
          profile: 'release',
          target: 'wasm32-unknown-unknown',
        },
        logger: createConsoleLogger('test'),
        spawn: async () => 101,
      }),
    ).rejects.toThrow(/failed to compile for wasm32-unknown-unknown/);
  });

  it('is given to runtimes only for a project with a crate', async () => {
    const root = await project('export default {};');
    expect(
      nativeCrateContext(root, createConsoleLogger('test')),
    ).toBeUndefined();
  });
});

describe('the Rust doctor check', () => {
  it('passes a recent Rust, and explains what is missing or old', () => {
    const probe =
      (versions: Record<string, string | undefined>) => (cmd: string) =>
        versions[cmd] === undefined
          ? { ok: false, error: 'not found' }
          : { ok: true, version: versions[cmd] };
    expect(
      checkRust(
        probe({
          cargo: 'cargo 1.90.0',
          rustc: 'rustc 1.90.0 (abc 2026-01-01)',
        }),
      ).status,
    ).toBe('ok');
    const missing = checkRust(probe({ rustc: 'rustc 1.90.0' }));
    expect(missing).toMatchObject({ status: 'fail' });
    expect(missing.suggestion).toContain('rustup');
    expect(
      checkRust(probe({ cargo: 'cargo 1.80.0', rustc: 'rustc 1.80.0' })),
    ).toMatchObject({
      status: 'fail',
      suggestion: 'Update it: rustup update stable.',
    });
  });
});
