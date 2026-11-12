import assert from 'node:assert/strict';
// The release resolver, on a fixture repo: what a pending runtime API change
// resolves to, what stays pending, and what a release may not ship.
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
  materializeSince,
  pendingChangeMayShip,
  resolveRuntimeApi,
} from './resolve-release.mjs';

/** The temporary repositories a test made, removed afterwards. */
const roots = [];
afterEach(() => {
  while (roots.length > 0)
    rmSync(roots.pop(), { recursive: true, force: true });
});

function parent(path) {
  return path.slice(0, path.lastIndexOf('/')) || '.';
}

function read(root, path) {
  return readFileSync(join(root, path), 'utf8');
}

/**
 * A repository with just what the resolver reads and writes: @soundor/config
 * with its record and sources, any number of packages holding `@since next`
 * annotations, and a HEAD whose @soundor/config is the last published
 * version.
 */
function fixture({
  released = 1,
  min = 1,
  next = null,
  version = '0.17.0',
  headVersion = '0.16.0',
  compatibility = null,
  packages = {},
  files = {},
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'resolve-release-'));
  roots.push(root);
  const config = join(root, 'packages/config');
  mkdirSync(join(config, 'src'), { recursive: true });
  const packages_ = {
    'packages/config': '0.17.0',
    'packages/react': '0.17.0',
    'packages/environment': '0.16.0',
    'runtimes/juce-runtime': '0.17.0',
    'engines/engine': '1.0.0',
    ...packages,
  };
  for (const [name, packageVersion] of Object.entries(packages_)) {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(
      join(root, name, 'package.json'),
      JSON.stringify({ name: name.split('/').pop(), version: packageVersion }),
    );
  }
  writeFileSync(
    join(config, 'src/version.ts'),
    `export const RUNTIME_API_VERSION = ${released + (next === null ? 0 : 1)};\n\nexport const MIN_RUNTIME_API_VERSION = ${next === 'break' ? released + 1 : min};\n`,
  );
  writeFileSync(
    join(config, 'src/compatibility.ts'),
    compatibility ??
      `import {\n  MIN_RUNTIME_API_VERSION,\n  NEXT_API_VERSION,\n  RUNTIME_API_VERSION,\n} from './version';\n\nexport const CONFIG_FEATURES = [\n  { since: NEXT_API_VERSION, name: 'persistent state' },\n];\n`,
  );
  writeFileSync(
    join(config, 'runtime-api.json'),
    `${JSON.stringify({ released, min, next, declarations: {} }, null, 2)}\n`,
  );
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(parent(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'head'],
    { cwd: root },
  );
  // HEAD's @soundor/config version, as the last published release left it.
  writeFileSync(
    join(config, 'package.json'),
    JSON.stringify({ name: 'config', version: headVersion }),
  );
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'bump'],
    { cwd: root },
  );
  writeFileSync(
    join(config, 'package.json'),
    JSON.stringify({ name: 'config', version }),
  );
  return root;
}

describe('pendingChangeMayShip', () => {
  it('needs a minor bump before 1.0, of either kind', () => {
    assert.equal(pendingChangeMayShip('raise', '0.16.0', '0.17.0'), undefined);
    assert.equal(pendingChangeMayShip('break', '0.16.0', '0.17.0'), undefined);
    assert.match(
      pendingChangeMayShip('raise', '0.16.0', '0.16.4'),
      /minor release/,
    );
    assert.match(
      pendingChangeMayShip('break', '0.16.0', '0.16.4'),
      /minor release/,
    );
  });

  it('needs a major bump for a break from 1.0 on', () => {
    assert.equal(pendingChangeMayShip('raise', '1.2.0', '1.3.0'), undefined);
    assert.equal(pendingChangeMayShip('raise', '1.2.0', '2.0.0'), undefined);
    assert.match(
      pendingChangeMayShip('break', '1.2.0', '1.3.0'),
      /major release/,
    );
    assert.equal(pendingChangeMayShip('break', '1.2.0', '2.0.0'), undefined);
    assert.equal(pendingChangeMayShip('break', '0.16.0', '1.0.0'), undefined);
  });

  it('reads prereleases as their base version', () => {
    assert.equal(
      pendingChangeMayShip('raise', '0.16.0', '0.17.0-next.1'),
      undefined,
    );
  });
});

describe('resolveRuntimeApi', () => {
  it('resolves a pending raise to released + 1', () => {
    const root = fixture({ next: 'raise' });
    const notes = resolveRuntimeApi(root);
    assert.equal(notes.length, 1);
    assert.match(notes[0], /Runtime API 1 -> 2 \(raise\)/);
    assert.equal(
      read(root, 'packages/config/src/version.ts'),
      'export const RUNTIME_API_VERSION = 2;\n\nexport const MIN_RUNTIME_API_VERSION = 1;\n',
    );
    const record = JSON.parse(read(root, 'packages/config/runtime-api.json'));
    assert.deepEqual(
      { released: record.released, min: record.min, next: record.next },
      { released: 2, min: 1, next: null },
    );
    assert.equal(
      read(root, 'packages/config/src/compatibility.ts'),
      `import {\n  MIN_RUNTIME_API_VERSION,\n  RUNTIME_API_VERSION,\n} from './version';\n\nexport const CONFIG_FEATURES = [\n  { since: 2, name: 'persistent state' },\n];\n`,
    );
    assert.equal(
      read(root, 'packages/config/package.json'),
      JSON.stringify({ name: 'config', version: '0.17.0' }),
    );
  });

  it('resolves a pending break by raising min with it', () => {
    const root = fixture({ next: 'break' });
    resolveRuntimeApi(root);
    assert.equal(
      read(root, 'packages/config/src/version.ts'),
      'export const RUNTIME_API_VERSION = 2;\n\nexport const MIN_RUNTIME_API_VERSION = 2;\n',
    );
    const record = JSON.parse(read(root, 'packages/config/runtime-api.json'));
    assert.equal(record.min, 2);
  });

  it('materializes every placeholder use and keeps a needed import', () => {
    const root = fixture({
      next: 'raise',
      compatibility: `import {\n  MIN_RUNTIME_API_VERSION,\n  NEXT_API_VERSION,\n  RUNTIME_API_VERSION,\n} from './version';\n\nexport const CONFIG_FEATURES = [\n  { since: NEXT_API_VERSION, name: 'a' },\n  { since: NEXT_API_VERSION, name: 'b' },\n];\n`,
    });
    resolveRuntimeApi(root);
    assert.equal(
      read(root, 'packages/config/src/compatibility.ts'),
      `import {\n  MIN_RUNTIME_API_VERSION,\n  RUNTIME_API_VERSION,\n} from './version';\n\nexport const CONFIG_FEATURES = [\n  { since: 2, name: 'a' },\n  { since: 2, name: 'b' },\n];\n`,
    );
  });

  it('leaves a pending change when this release does not publish config', () => {
    const root = fixture({ next: 'raise', version: '0.16.0' });
    const notes = resolveRuntimeApi(root);
    assert.match(notes[0], /stays/);
    const record = JSON.parse(read(root, 'packages/config/runtime-api.json'));
    assert.equal(record.next, 'raise');
    assert.match(
      read(root, 'packages/config/src/version.ts'),
      /RUNTIME_API_VERSION = 2;/,
    );
  });

  it('does nothing without a pending change', () => {
    const root = fixture({ next: null });
    assert.deepEqual(resolveRuntimeApi(root), []);
    const record = JSON.parse(read(root, 'packages/config/runtime-api.json'));
    assert.equal(record.released, 1);
  });

  it('refuses a pending change in a patch release', () => {
    const root = fixture({ next: 'raise', version: '0.16.1' });
    assert.throws(() => resolveRuntimeApi(root), /minor release/);
  });
});

describe('materializeSince', () => {
  it("writes each package's new version over its @since next", () => {
    const root = fixture({
      files: {
        'packages/react/src/press.ts':
          '/** Presses. @since next */\nexport function press() {}\n',
        'packages/environment/ui.d.ts':
          '// a module\nexport interface Ui {\n  /** The node. @since next */\n  node: string;\n}\n',
        'runtimes/juce-runtime/src/dev.ts':
          '/** Reloads. @since next */\nexport const reload = 1;\n',
        'engines/engine/scripts/native.ts':
          '/** Lowers. @since next */\nexport const lower = 1;\n',
        'packages/react/src/index.ts': "export { press } from './press';\n",
        'packages/config/src/load.ts':
          '/** Loads. @since next.x */\nexport const load = 1;\n',
      },
    });
    const notes = materializeSince(root);
    assert.equal(notes.length, 4);
    assert.equal(
      read(root, 'packages/react/src/press.ts'),
      '/** Presses. @since 0.17.0 */\nexport function press() {}\n',
    );
    assert.equal(
      read(root, 'packages/environment/ui.d.ts'),
      '// a module\nexport interface Ui {\n  /** The node. @since 0.16.0 */\n  node: string;\n}\n',
    );
    assert.equal(
      read(root, 'runtimes/juce-runtime/src/dev.ts'),
      '/** Reloads. @since 0.17.0 */\nexport const reload = 1;\n',
    );
    assert.equal(
      read(root, 'engines/engine/scripts/native.ts'),
      '/** Lowers. @since 1.0.0 */\nexport const lower = 1;\n',
    );
    // A re-export and a version-adjacent token are not annotations.
    assert.equal(
      read(root, 'packages/react/src/index.ts'),
      "export { press } from './press';\n",
    );
    assert.equal(
      read(root, 'packages/config/src/load.ts'),
      '/** Loads. @since next.x */\nexport const load = 1;\n',
    );
  });

  it('takes a package version from the nearest package.json', () => {
    const root = fixture({
      files: {
        'packages/react/src/deep/inner.ts':
          '/** Deep. @since next */\nexport const deep = 1;\n',
      },
    });
    materializeSince(root);
    assert.match(
      read(root, 'packages/react/src/deep/inner.ts'),
      /@since 0.17.0/,
    );
  });

  it('skips tests, build output and generated directories', () => {
    const root = fixture({
      files: {
        'packages/react/src/press.test.ts': '/** @since next */\n',
        'packages/react/dist/index.d.ts': '/** @since next */\n',
        'examples/basic/.soundor/generated/ui.d.ts': '/** @since next */\n',
        'packages/react/node_modules/left/index.d.ts': '/** @since next */\n',
      },
    });
    assert.deepEqual(materializeSince(root), []);
  });
});
