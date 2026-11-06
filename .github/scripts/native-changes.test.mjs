import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./native-changes.mjs', import.meta.url));
const repo = fileURLToPath(new URL('../..', import.meta.url));
const turbo = join(
  repo,
  'node_modules/.bin',
  process.platform === 'win32' ? 'turbo.cmd' : 'turbo',
);

const append =
  (path, comment = '//') =>
  (root) =>
    appendFileSync(join(root, path), `\n${comment} fixture\n`);
const create = (path) => (root) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), 'fixture\n');
};
const bump = (path) => (root) => {
  const file = join(root, path);
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  manifest.version = manifest.version.replace(/\d+$/, (n) => `${+n + 1}`);
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
};

// A new version of <name> in pnpm-lock.yaml, as a bump records it: its
// package entries and every importer that resolves it.
const relock = (name) => (root) => {
  const file = join(root, 'pnpm-lock.yaml');
  const lock = readFileSync(file, 'utf8');
  const escaped = name.replace(/[/@.]/g, '\\$&');
  const version = new RegExp(`${escaped}@([^\\s:'()]+)`).exec(lock)[1];
  const bumped = `${version}-fixture`;
  writeFileSync(
    file,
    lock
      .replaceAll(`${name}@${version}`, `${name}@${bumped}`)
      .replace(
        new RegExp(
          `(\\n +'?${escaped}'?:\\n +specifier: [^\\n]+\\n +version: )${version.replace(/\./g, '\\.')}`,
          'g',
        ),
        `$1${bumped}`,
      ),
  );
};

// [change, native, juce, benchmark, host, orbit]: the jobs testing
// @soundor/engine, @soundor/juce-runtime, soundor-benchmark, @soundor/vst3-host
// and the Orbit example, from the packages they depend on.
const cases = [
  // None of them depends on these.
  [
    'a docs page',
    create('apps/website/content/docs/(docs)/guide.md'),
    false,
    false,
    false,
    false,
    false,
  ],
  [
    'an example',
    append('examples/basic/src/main.tsx'),
    false,
    false,
    false,
    false,
    false,
  ],
  [
    'oxfmt.config.ts',
    append('oxfmt.config.ts'),
    false,
    false,
    false,
    false,
    false,
  ],
  [
    'lockfile comment',
    append('pnpm-lock.yaml', '#'),
    false,
    false,
    false,
    false,
    false,
  ],
  // The benchmark's React scenarios (and its web runtime); the test plugin's
  // UI is soundor:ui itself.
  [
    'web runtime source',
    append('runtimes/web-runtime/src/index.ts'),
    false,
    false,
    true,
    false,
    true,
  ],
  [
    'packages/react source',
    append('packages/react/src/index.ts'),
    false,
    false,
    true,
    false,
    true,
  ],
  // What both build plugins with: the CLI, and the codegen in core.
  [
    'packages/cli source',
    append('packages/cli/src/index.ts'),
    false,
    true,
    true,
    false,
    true,
  ],
  [
    'Fastify (the CLI’s DevTools)',
    relock('fastify'),
    false,
    true,
    true,
    false,
    true,
  ],
  [
    'packages/core source',
    append('packages/core/src/index.ts'),
    false,
    true,
    true,
    false,
    true,
  ],
  [
    'version-only bumps (release PR)',
    (root) => {
      bump('packages/core/package.json')(root);
      bump('runtimes/juce-runtime/package.json')(root);
      create('packages/core/CHANGELOG.md')(root);
    },
    false,
    true,
    true,
    false,
    true,
  ],
  [
    'JUCE adapter',
    create('runtimes/juce-runtime/native/backend/juce/Fixture.cpp'),
    false,
    true,
    true,
    false,
    true,
  ],
  [
    'the test plugin',
    append('runtimes/juce-runtime/tests/plugin/src/main.tsx'),
    false,
    true,
    true,
    false,
    true,
  ],
  [
    'the benchmark',
    append('tools/benchmark/scripts/bench.ts'),
    false,
    false,
    true,
    false,
    false,
  ],
  // The engine, which everything native builds on, and what it depends on.
  [
    'engine source',
    append('runtimes/engine/src/js/Bindings.h'),
    true,
    true,
    true,
    false,
    true,
  ],
  [
    'engine lowering',
    append('runtimes/engine/scripts/native-module.ts'),
    true,
    true,
    true,
    false,
    true,
  ],
  // Orbit's own tests, and what runs them.
  [
    'Orbit e2e test',
    create('examples/orbit/e2e/fixture.test.ts'),
    false,
    false,
    false,
    false,
    true,
  ],
  [
    'the e2e package',
    append('packages/vitest-e2e/src/index.ts'),
    false,
    false,
    false,
    false,
    true,
  ],
  // The VST3 host depends on no other workspace package's code.
  [
    'host native source',
    append('hosts/vst3-host/native/src/Plugin.cpp'),
    false,
    false,
    false,
    true,
    true,
  ],
  [
    'host client',
    append('hosts/vst3-host/src/host.ts'),
    false,
    false,
    false,
    true,
    true,
  ],
  // Its own change alone is its job's and Orbit's; with another package, the graph decides.
  [
    'the host and the Driver',
    (root) => {
      append('hosts/vst3-host/src/host.ts')(root);
      append('packages/driver/src/vst3.ts')(root);
    },
    false,
    true,
    true,
    true,
    true,
  ],
  [
    'host workflow',
    append('.github/workflows/vst3-host-artifacts.yml'),
    true,
    true,
    true,
    true,
    true,
  ],
  [
    'engine NOTICE.md',
    append('runtimes/engine/NOTICE.md'),
    true,
    true,
    true,
    false,
    true,
  ],
  [
    'Babel (the lowering)',
    relock('@babel/core'),
    true,
    true,
    true,
    false,
    true,
  ],
  [
    'configs/',
    append('configs/typescript-config/node.json'),
    true,
    true,
    true,
    true,
    true,
  ],
  // turbo's global dependencies and CI itself.
  ['.clang-tidy', append('.clang-tidy'), true, true, true, true, true],
  ['.nvmrc', append('.nvmrc'), true, true, true, true, true],
  [
    'verify workflow',
    append('.github/workflows/verify.yml'),
    true,
    true,
    true,
    true,
    true,
  ],
  [
    'prebuilt workflow',
    append('.github/workflows/engine-prebuilts.yml'),
    true,
    true,
    true,
    true,
    true,
  ],
  [
    'artifact workflow',
    append('.github/workflows/engine-artifacts.yml'),
    true,
    true,
    true,
    true,
    true,
  ],
  [
    'release workflow',
    append('.github/workflows/release.yml'),
    true,
    true,
    true,
    true,
    true,
  ],
];

test('native jobs follow the affected packages they test', () => {
  const root = mkdtempSync(join(tmpdir(), 'soundor-inputs-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  execFileSync('git', ['worktree', 'add', '-q', '--detach', root, 'HEAD'], {
    cwd: repo,
  });
  try {
    // The configuration being tested is the working tree's, committed or not.
    const config = [
      '*turbo.json',
      '*package.json',
      'pnpm-workspace.yaml',
      'pnpm-lock.yaml',
      '.github/scripts',
      '.github/workflows',
    ];
    const uncommitted = [
      ['diff', '--name-only', 'HEAD', '--', ...config],
      ['ls-files', '--others', '--exclude-standard', '--', ...config],
    ].flatMap((args) =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
        .split('\n')
        .filter(Boolean),
    );
    for (const path of uncommitted) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), readFileSync(join(repo, path)));
    }
    git('add', '-A');
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qam',
      'base',
      '--allow-empty',
      '--no-verify',
    );
    const base = git('rev-parse', 'HEAD');
    for (const [name, change, native, juce, benchmark, host, orbit] of cases) {
      git('reset', '-q', '--hard', base);
      git('clean', '-qfd');
      change(root);
      git('add', '-A');
      git(
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        'commit',
        '-qm',
        name,
        '--no-verify',
      );
      const output = join(root, '.output');
      execFileSync(process.execPath, [script], {
        cwd: root,
        env: {
          ...process.env,
          BASE_SHA: base,
          HEAD_SHA: git('rev-parse', 'HEAD'),
          GITHUB_OUTPUT: output,
          TURBO_BIN: turbo,
          TURBO_TELEMETRY_DISABLED: '1',
        },
      });
      assert.equal(
        readFileSync(output, 'utf8'),
        `native=${native}\njuce=${juce}\nbenchmark=${benchmark}\nhost=${host}\norbit=${orbit}\n`,
        name,
      );
      rmSync(output);
    }
  } finally {
    execFileSync('git', ['worktree', 'remove', '--force', root], { cwd: repo });
  }
});

test('an unknown base runs every native job', () => {
  const root = mkdtempSync(join(tmpdir(), 'soundor-inputs-'));
  try {
    const output = join(root, 'output');
    execFileSync(process.execPath, [script], {
      cwd: root,
      env: { ...process.env, BASE_SHA: '0'.repeat(40), GITHUB_OUTPUT: output },
    });
    assert.equal(
      readFileSync(output, 'utf8'),
      'native=true\njuce=true\nbenchmark=true\nhost=true\norbit=true\n',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
