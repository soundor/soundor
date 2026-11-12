import assert from 'node:assert/strict';
// The release resolver, on a fixture repo: what a pending runtime API change
// resolves to, what stays pending, and what a release may not ship.
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { pendingChangeMayShip, resolveRuntimeApi } from './resolve-release.mjs';

/** The temporary repositories a test made, removed afterwards. */
const roots = [];
afterEach(() => {
  while (roots.length > 0)
    rmSync(roots.pop(), { recursive: true, force: true });
});

function read(root, path) {
  return readFileSync(join(root, path), 'utf8');
}

/**
 * A repository with just what the resolver reads and writes: @soundor/config
 * with its record and sources, and a HEAD whose @soundor/config is the
 * last published version.
 */
function fixture({
  released = 1,
  min = 1,
  next = null,
  version = '0.17.0',
  headVersion = '0.16.0',
  compatibility = null,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'resolve-release-'));
  roots.push(root);
  const config = join(root, 'packages/config');
  mkdirSync(join(config, 'src'), { recursive: true });
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
  writeFileSync(
    join(config, 'package.json'),
    JSON.stringify({ name: 'config', version: headVersion }),
  );
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'head'],
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
