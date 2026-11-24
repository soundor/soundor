import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { isSoundorError } from './errors';
import {
  addedNotices,
  crateNotices,
  directoryNotices,
  isLicenseFile,
  javascriptNotices,
  LicenseNoticeError,
  rustStdNotice,
  settleNotices,
  summarizeNotices,
  writeNotices,
  type Notice,
  type ResolvedLicenses,
  type RunTool,
} from './notices';

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

/** A directory with `files` (path → contents) written into it. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'soundor-notices-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  return root;
}

const pkg = (name: string, version: string, license?: string) =>
  JSON.stringify({ name, version, ...(license ? { license } : {}) });

const licenses = (overrides: Partial<ResolvedLicenses>): ResolvedLicenses => ({
  add: [],
  packages: {},
  crates: {},
  ...overrides,
});

describe('isLicenseFile', () => {
  it('knows license and notice files, whatever their extension', () => {
    for (const name of [
      'LICENSE',
      'LICENSE.md',
      'license.txt',
      'LICENSE-MIT',
      'LICENCE',
      'COPYING',
      'NOTICE.md',
      'OFL.txt',
      'THIRD_PARTY_NOTICES.md',
      'musl-COPYRIGHT'.slice(5),
    ])
      expect(isLicenseFile(name), name).toBe(true);
  });

  it('never takes a source file for one', () => {
    for (const name of [
      'license.js',
      'LICENSE.d.ts',
      'licenses.json',
      'index.js',
    ])
      expect(isLicenseFile(name), name).toBe(false);
  });
});

describe('javascriptNotices', () => {
  it("gives each package's file the license nearest to it", () => {
    const root = tree({
      'package.json': pkg('plugin', '1.0.0'),
      LICENSE: 'the plugin',
      'src/main.tsx': '',
      'node_modules/react/package.json': pkg('react', '19.0.0', 'MIT'),
      'node_modules/react/LICENSE': 'React',
      'node_modules/react/cjs/react.production.js': '',
      'node_modules/@acme/ui/package.json': pkg('@acme/ui', '0.3.0', 'MIT'),
      'node_modules/@acme/ui/LICENSE': 'Acme UI',
      'node_modules/@acme/ui/dist/theme.js': '',
      'node_modules/@acme/ui/assets/geist/Geist.ttf': '',
      'node_modules/@acme/ui/assets/geist/OFL.txt': 'Geist OFL',
    });
    const { notices, issues } = javascriptNotices(
      [
        join(root, 'src/main.tsx'),
        join(root, 'node_modules/react/cjs/react.production.js'),
        join(root, 'node_modules/@acme/ui/dist/theme.js'),
        join(root, 'node_modules/@acme/ui/assets/geist/Geist.ttf'),
        '\0soundor:env',
      ],
      { root },
    );
    expect(issues).toEqual([]);
    expect(
      notices.map((notice) => ({
        directory: notice.directory,
        license: notice.license,
        files: notice.files.map((file) => file.path),
      })),
    ).toEqual([
      {
        directory: 'javascript/@acme/ui@0.3.0',
        license: 'MIT',
        files: ['assets/geist/OFL.txt', 'LICENSE'],
      },
      {
        directory: 'javascript/react@19.0.0',
        license: 'MIT',
        files: ['LICENSE'],
      },
    ]);
  });

  it("counts a package's own nested package.json as part of it", () => {
    const root = tree({
      'package.json': pkg('plugin', '1.0.0'),
      'node_modules/preact/package.json': pkg('preact', '11.0.0', 'MIT'),
      'node_modules/preact/LICENSE': 'Preact',
      'node_modules/preact/hooks/package.json': pkg('preact-hooks', '0.1.0'),
      'node_modules/preact/hooks/dist/hooks.mjs': '',
    });
    const { notices } = javascriptNotices(
      [join(root, 'node_modules/preact/hooks/dist/hooks.mjs')],
      { root },
    );
    expect(notices.map((notice) => notice.directory)).toEqual([
      'javascript/preact@11.0.0',
    ]);
  });

  it("gives the project's files the notices beside them, never its own", () => {
    const root = tree({
      'package.json': pkg('plugin', '1.0.0'),
      LICENSE: 'the plugin',
      'src/main.tsx': '',
      'src/fonts/Inter.ttf': '',
      'src/fonts/OFL.txt': 'Inter OFL',
    });
    const { notices } = javascriptNotices(
      [join(root, 'src/main.tsx'), join(root, 'src/fonts/Inter.ttf')],
      { root },
    );
    expect(notices).toEqual([
      {
        section: 'project',
        name: 'src/fonts',
        origin: 'found',
        directory: 'project/src/fonts',
        files: [{ path: 'OFL.txt', source: join(root, 'src/fonts/OFL.txt') }],
      },
    ]);
  });

  it('counts a project inside a package as the project', () => {
    const outer = tree({
      'package.json': pkg('@acme/runtime', '1.0.0', 'MIT'),
      LICENSE: 'the runtime',
      'tests/plugin/soundor.config.ts': '',
      'tests/plugin/src/main.ts': '',
    });
    const { notices, issues } = javascriptNotices(
      [join(outer, 'tests/plugin/src/main.ts')],
      { root: join(outer, 'tests/plugin') },
    );
    expect(issues).toEqual([]);
    expect(notices).toEqual([]);
  });

  it("counts a file of the project's monorepo, outside the project, as its own", () => {
    const repository = tree({
      'pnpm-workspace.yaml': '',
      'package.json': JSON.stringify({
        name: 'orbit-workspace',
        private: true,
      }),
      LICENSE: 'the repository',
      'assets/brand/LICENSE.md': 'the logo',
      'assets/brand/logo.svg': '',
      'assets/shared.ts': '',
      'apps/plugin/package.json': pkg('orbit', '0.1.0'),
      'apps/plugin/src/main.tsx': '',
    });
    const { notices, issues } = javascriptNotices(
      [
        join(repository, 'apps/plugin/src/main.tsx'),
        join(repository, 'assets/brand/logo.svg'),
        join(repository, 'assets/shared.ts'),
      ],
      { root: join(repository, 'apps/plugin') },
    );
    expect(issues).toEqual([]);
    expect(notices).toEqual([
      {
        section: 'project',
        name: 'assets/brand',
        origin: 'found',
        directory: 'project/assets/brand',
        files: [
          {
            path: 'LICENSE.md',
            source: join(repository, 'assets/brand/LICENSE.md'),
          },
        ],
      },
    ]);
  });

  it("takes a pnpm workspace package's notice from the workspace root, as pnpm publish does", () => {
    const workspace = tree({
      'pnpm-workspace.yaml': '',
      LICENSE: 'the workspace',
      'packages/react/package.json': pkg('@soundor/react', '0.20.0', 'MIT'),
      'packages/react/dist/index.mjs': '',
      'examples/basic/package.json': pkg('basic', '0.1.0'),
    });
    const { notices, issues } = javascriptNotices(
      [join(workspace, 'packages/react/dist/index.mjs')],
      { root: join(workspace, 'examples/basic') },
    );
    expect(issues).toEqual([]);
    expect(notices[0]!.files).toEqual([
      { path: 'LICENSE', source: join(workspace, 'LICENSE') },
    ]);
  });

  it('reports a package without a license text, and the config resolves it', () => {
    const root = tree({
      'package.json': pkg('plugin', '1.0.0'),
      'node_modules/tiny/package.json': pkg('tiny', '1.2.3', 'MIT'),
      'node_modules/tiny/index.js': '',
      'node_modules/mine/package.json': pkg('mine', '2.0.0'),
      'node_modules/mine/index.js': '',
      'licenses/tiny.txt': 'Tiny, MIT',
    });
    const files = [
      join(root, 'node_modules/tiny/index.js'),
      join(root, 'node_modules/mine/index.js'),
    ];
    const missing = javascriptNotices(files, { root });
    expect(missing.issues.map((issue) => issue.path)).toEqual([
      'licenses.packages.mine',
      'licenses.packages.tiny',
    ]);
    expect(missing.issues[1]!.message).toContain('tiny 1.2.3 (MIT)');

    const resolved = javascriptNotices(files, {
      root,
      licenses: licenses({
        packages: {
          tiny: { license: 'MIT', file: join(root, 'licenses/tiny.txt') },
          mine: false,
          gone: false,
        },
      }),
    });
    expect(resolved.issues).toEqual([]);
    expect(
      resolved.notices.map((notice) => [
        notice.name,
        notice.origin,
        notice.files.length,
      ]),
    ).toEqual([
      ['mine', 'excluded', 0],
      ['tiny', 'override', 1],
    ]);
    expect(resolved.unused).toEqual(['licenses.packages.gone']);
  });
});

/** `cargo metadata` and `rustc` answering as for a crate graph. */
function cargo(
  root: string,
  metadata: unknown,
  rustc: { sysroot?: string; release?: string } = {},
): RunTool {
  return (command, args) => {
    if (command === 'cargo')
      return { status: 0, stdout: JSON.stringify(metadata), stderr: '' };
    if (args[0] === '-vV')
      return {
        status: 0,
        stdout: `rustc ${rustc.release ?? '1.90.0'}\nrelease: ${rustc.release ?? '1.90.0'}\n`,
        stderr: '',
      };
    return { status: 0, stdout: `${rustc.sysroot ?? root}\n`, stderr: '' };
  };
}

describe('crateNotices', () => {
  const graph = (root: string) => {
    const crate = (
      name: string,
      kind = 'lib',
      license: string | null = 'MIT',
    ) => ({
      id: `${name}-id`,
      name,
      version: '1.0.0',
      license,
      license_file: null,
      manifest_path: join(root, name, 'Cargo.toml'),
      targets: [{ kind: [kind] }],
    });
    const dep = (name: string, kind: string | null = null) => ({
      pkg: `${name}-id`,
      dep_kinds: [{ kind }],
    });
    return {
      packages: [
        crate('plugin'),
        crate('serde'),
        crate('serde_derive', 'proc-macro'),
        crate('syn'),
        crate('cc'),
        crate('proptest'),
        crate('unlicensed', 'lib', null),
      ],
      resolve: {
        root: 'plugin-id',
        nodes: [
          {
            id: 'plugin-id',
            deps: [
              dep('serde'),
              dep('serde_derive'),
              dep('cc', 'build'),
              dep('proptest', 'dev'),
              dep('unlicensed'),
            ],
          },
          { id: 'serde-id', deps: [] },
          { id: 'serde_derive-id', deps: [dep('syn')] },
        ],
      },
    };
  };

  it('lists the crates the library links: no build or dev dependencies, no procedural macros', () => {
    const root = tree({
      'serde/LICENSE-MIT': 'serde',
      'serde/LICENSE-APACHE': 'serde',
      'unlicensed/README.md': '',
    });
    const collection = crateNotices({
      manifest: join(root, 'plugin/Cargo.toml'),
      target: 'x86_64-unknown-linux-gnu',
      cwd: root,
      run: cargo(root, graph(root)),
    });
    expect(collection.notices.map((notice) => notice.directory)).toEqual([
      'rust/serde@1.0.0',
    ]);
    expect(collection.notices[0]!.files.map((file) => file.path)).toEqual([
      'LICENSE-APACHE',
      'LICENSE-MIT',
    ]);
    expect(collection.issues).toEqual([
      {
        path: 'licenses.crates.unlicensed',
        message: expect.stringContaining(
          'unlicensed 1.0.0 (no license declared)',
        ),
      },
    ]);
  });

  it('applies overrides by crate name', () => {
    const root = tree({ 'serde/LICENSE': 'serde', 'u.txt': 'text' });
    const collection = crateNotices({
      manifest: join(root, 'plugin/Cargo.toml'),
      target: 'wasm32-unknown-unknown',
      cwd: root,
      licenses: licenses({
        crates: {
          unlicensed: { license: 'BSD-3-Clause', file: join(root, 'u.txt') },
        },
      }),
      run: cargo(root, graph(root)),
    });
    expect(collection.issues).toEqual([]);
    expect(
      collection.notices.map((notice) => [notice.name, notice.origin]),
    ).toEqual([
      ['serde', 'found'],
      ['unlicensed', 'override'],
    ]);
  });
});

describe('rustStdNotice', () => {
  it("ships the toolchain's notices of the standard library", () => {
    const sysroot = tree({ 'share/doc/rust/COPYRIGHT-library.html': '<html>' });
    const { notices, issues } = rustStdNotice({
      cwd: sysroot,
      run: cargo(sysroot, {}, { sysroot, release: '1.91.0' }),
    });
    expect(issues).toEqual([]);
    expect(notices).toEqual([
      expect.objectContaining({
        directory: 'rust/std@1.91.0',
        license: 'MIT OR Apache-2.0',
        files: [
          {
            path: 'COPYRIGHT-library.html',
            source: join(sysroot, 'share/doc/rust/COPYRIGHT-library.html'),
          },
        ],
      }),
    ]);
  });

  it('reports a toolchain without them', () => {
    const sysroot = tree({});
    expect(
      rustStdNotice({ cwd: sysroot, run: cargo(sysroot, {}, { sysroot }) })
        .issues,
    ).toEqual([expect.objectContaining({ path: 'licenses.crates.std' })]);
  });
});

describe('writeNotices', () => {
  it('lays out every component, one text with all of them, and licenses.json', async () => {
    const root = tree({
      'engine/skia/LICENSE': 'Skia',
      'engine/skia/libpng/LICENSE': 'libpng',
      'sdk/LICENSE.txt': 'VST3 SDK',
      'react/LICENSE': 'React',
      'irs.txt': 'CC BY 4.0',
    });
    const notices: Notice[] = [
      {
        section: 'javascript',
        name: 'react',
        version: '19.0.0',
        license: 'MIT',
        origin: 'found',
        directory: 'javascript/react@19.0.0',
        files: [{ path: 'LICENSE', source: join(root, 'react/LICENSE') }],
      },
      ...directoryNotices('engine', join(root, 'engine')),
      ...directoryNotices('vst3-sdk', join(root, 'sdk'), { name: 'VST3 SDK' }),
      ...addedNotices(
        licenses({
          add: [
            {
              name: 'Impulse responses',
              license: 'CC-BY-4.0',
              file: join(root, 'irs.txt'),
            },
          ],
        }),
      ),
    ];
    const out = join(root, 'out');
    await writeNotices(out, notices, { title: 'Acme Reverb' });

    expect(readFileSync(join(out, 'engine/skia/libpng/LICENSE'), 'utf8')).toBe(
      'libpng',
    );
    expect(readFileSync(join(out, 'vst3-sdk/LICENSE.txt'), 'utf8')).toBe(
      'VST3 SDK',
    );
    expect(
      readFileSync(join(out, 'project/Impulse responses/irs.txt'), 'utf8'),
    ).toBe('CC BY 4.0');
    const text = readFileSync(join(out, 'THIRD-PARTY-NOTICES.txt'), 'utf8');
    expect(text.startsWith('Third-party notices: Acme Reverb\n')).toBe(true);
    // Engine, then the runtime's own sections, then JavaScript, then the project.
    expect(text.indexOf('engine/skia')).toBeLessThan(text.indexOf('vst3-sdk'));
    expect(text.indexOf('vst3-sdk')).toBeLessThan(
      text.indexOf('javascript/react'),
    );
    expect(text).toContain('react 19.0.0 (MIT)  [javascript/react@19.0.0]');
    expect(text).toContain('--- engine/skia/libpng/LICENSE\n\nlibpng');
    const manifest = JSON.parse(
      readFileSync(join(out, 'licenses.json'), 'utf8'),
    );
    expect(manifest.format).toBe(1);
    expect(
      manifest.components.map(
        (component: { directory: string }) => component.directory,
      ),
    ).toEqual([
      'engine/skia',
      'vst3-sdk',
      'javascript/react@19.0.0',
      'project/Impulse responses',
    ]);
    expect(summarizeNotices(notices)).toBe(
      '4 components (CC-BY-4.0 1, MIT 1, other 2)',
    );
  });

  it('refuses two components in one folder', async () => {
    const root = tree({ 'a/LICENSE': 'a' });
    const notice = (name: string): Notice => ({
      section: 'javascript',
      name,
      origin: 'found',
      directory: 'javascript/same',
      files: [{ path: 'LICENSE', source: join(root, 'a/LICENSE') }],
    });
    await expect(
      writeNotices(join(root, 'out'), [notice('a'), notice('b')], {
        title: 'x',
      }),
    ).rejects.toThrow('same notice folder');
  });
});

describe('settleNotices', () => {
  it('fails on every missing text at once, naming the config that fixes it', () => {
    let error: unknown;
    try {
      settleNotices([
        {
          notices: [],
          issues: [
            { path: 'licenses.packages.a', message: 'a ships no license file' },
            { path: 'licenses.crates.b', message: 'b ships no license file' },
          ],
          unused: [],
        },
      ]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(LicenseNoticeError);
    expect(isSoundorError(error, 'CONFIG')).toBe(true);
    expect((error as Error).message).toContain(
      '2 components of the build have',
    );
    expect((error as Error).message).toContain(
      'licenses.crates.b: b ships no license file',
    );
    expect((error as Error).message).toContain('licenses: { packages:');
  });

  it('hands a development build the problems, with the notices found', () => {
    const missing: LicenseNoticeError[] = [];
    const settled = settleNotices(
      [
        {
          notices: [
            {
              section: 'rust',
              name: 'serde',
              origin: 'found',
              directory: 'rust/serde',
              files: [],
            },
          ],
          issues: [{ path: 'licenses.crates.b', message: 'b ships none' }],
          unused: [],
        },
      ],
      { onMissing: (error) => missing.push(error) },
    );
    expect(settled.notices.map((notice) => notice.name)).toEqual(['serde']);
    expect(missing[0]!.issues).toEqual([
      { path: 'licenses.crates.b', message: 'b ships none' },
    ]);
  });
});
