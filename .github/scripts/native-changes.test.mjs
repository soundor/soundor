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

// [change, native, juce]. Native: @soundor/engine (and examples/benchmark's own
// files); JUCE: @soundor/juce-runtime (and examples/basic's own files).
const cases = [
  // Neither package depends on them.
  ['docs/guide.md', create('docs/guide.md'), false, false],
  [
    'packages/react source',
    append('packages/react/src/index.ts'),
    false,
    false,
  ],
  [
    'web runtime source',
    append('runtimes/web-runtime/src/index.ts'),
    false,
    false,
  ],
  ['oxfmt.config.ts', append('oxfmt.config.ts'), false, false],
  ['Fastify (DevTools server)', relock('fastify'), false, false],
  ['lockfile comment', append('pnpm-lock.yaml', '#'), false, false],
  // juce-runtime depends on core, the engine on neither.
  ['packages/core source', append('packages/core/src/index.ts'), false, true],
  [
    'version-only bumps (release PR)',
    (root) => {
      bump('packages/core/package.json')(root);
      bump('runtimes/juce-runtime/package.json')(root);
      create('packages/core/CHANGELOG.md')(root);
    },
    false,
    true,
  ],
  [
    'JUCE adapter',
    create('runtimes/juce-runtime/native/backend/juce/Fixture.cpp'),
    false,
    true,
  ],
  [
    'juce-runtime codegen',
    append('runtimes/juce-runtime/src/native-codegen.ts'),
    false,
    true,
  ],
  ['basic example', append('examples/basic/src/main.tsx'), false, true],
  [
    'benchmark example',
    append('examples/benchmark/scripts/bench.ts'),
    true,
    false,
  ],
  // The engine, which juce-runtime depends on, and what it depends on.
  ['engine source', append('runtimes/engine/src/js/Bindings.h'), true, true],
  [
    'engine lowering',
    append('runtimes/engine/scripts/native-module.ts'),
    true,
    true,
  ],
  ['engine NOTICE.md', append('runtimes/engine/NOTICE.md'), true, true],
  ['engine README.md', append('runtimes/engine/README.md'), true, true],
  ['Babel (the lowering)', relock('@babel/core'), true, true],
  ['configs/', append('configs/typescript-config/node.json'), true, true],
  // turbo's global dependencies and CI itself.
  ['.clang-tidy', append('.clang-tidy'), true, true],
  ['.nvmrc', append('.nvmrc'), true, true],
  ['verify workflow', append('.github/workflows/verify.yml'), true, true],
];

test('native jobs follow turbo’s affected packages', () => {
  const root = mkdtempSync(join(tmpdir(), 'soundor-inputs-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  execFileSync('git', ['worktree', 'add', '-q', '--detach', root, 'HEAD'], {
    cwd: repo,
  });
  try {
    // The configuration being tested is the working tree's, committed or not.
    const config = ['*turbo.json', '*package.json', '.github/scripts'];
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
    for (const [name, change, native, juce] of cases) {
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
        `native=${native}\njuce=${juce}\n`,
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
    assert.equal(readFileSync(output, 'utf8'), 'native=true\njuce=true\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
