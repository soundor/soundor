import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  bumped,
  check,
  followingLine,
  pendingBumps,
} from './runtime-compatibility.mjs';

/** A repository with config and core at `version`, one runtime, and changesets. */
function repo({ version = '0.16.0', range, changesets = {} }) {
  const root = mkdtempSync(join(tmpdir(), 'runtime-compat-'));
  const write = (path, data) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(
      join(root, path),
      typeof data === 'string' ? data : JSON.stringify(data),
    );
  };
  write('packages/config/package.json', { name: '@soundor/config', version });
  write('packages/core/package.json', { name: '@soundor/core', version });
  write('runtimes/third/package.json', {
    name: 'soundor-runtime-third',
    version: '1.0.0',
    soundor: { compatibility: { config: range, core: range, schemas: [1] } },
  });
  write('.changeset/config.json', {
    fixed: [['@soundor/config', '@soundor/core', 'soundor']],
  });
  write('.changeset/README.md', '# Changesets\n');
  for (const [file, text] of Object.entries(changesets))
    write(`.changeset/${file}`, text);
  return root;
}

const changeset = (packages) =>
  `---\n${Object.entries(packages)
    .map(([name, bump]) => `'${name}': ${bump}`)
    .join('\n')}\n---\n\nA change.\n`;

test('versions', () => {
  assert.equal(bumped('0.16.3', 'minor'), '0.17.0');
  assert.equal(bumped('0.16.3', 'patch'), '0.16.4');
  assert.equal(bumped('0.16.3', undefined), '0.16.3');
  assert.equal(followingLine('0.16.3'), '0.17.0');
  assert.equal(followingLine('1.4.0'), '2.0.0');
});

test('pending bumps apply to the whole fixed group', (t) => {
  const root = repo({
    range: '^0.16.0',
    changesets: {
      'a.md': changeset({ soundor: 'patch' }),
      'b.md': changeset({
        '@soundor/core': 'minor',
        '@soundor/engine': 'minor',
      }),
    },
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bumps = pendingBumps(root);
  assert.equal(bumps.get('@soundor/config'), 'minor');
  assert.equal(bumps.get('soundor'), 'minor');
  assert.equal(bumps.get('@soundor/engine'), 'minor');
});

test('a range of the tested line passes when nothing is pending', (t) => {
  const root = repo({ range: '>=0.16.0 <0.17.0' });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(check(root), []);
});

test('a pending minor needs the next line too', (t) => {
  const changesets = { 'a.md': changeset({ '@soundor/config': 'minor' }) };
  const narrow = repo({ range: '^0.16.0', changesets });
  const wide = repo({ range: '>=0.16.0 <0.18.0', changesets });
  t.after(() => {
    rmSync(narrow, { recursive: true, force: true });
    rmSync(wide, { recursive: true, force: true });
  });
  const problems = check(narrow);
  assert.equal(problems.length, 2);
  assert.match(
    problems[0],
    /excludes @soundor\/config 0\.17\.0, which the pending changesets release \(a minor\)/,
  );
  assert.match(problems[0], /">=0\.16\.0 <0\.18\.0"/);
  assert.deepEqual(check(wide), []);
});

test('a range must cover the tested version and end before untested lines', (t) => {
  const stale = repo({ version: '0.17.0', range: '>=0.15.0 <0.17.0' });
  const open = repo({ range: '>=0.16.0' });
  const malformed = repo({ range: '0.16' });
  t.after(() => {
    for (const root of [stale, open, malformed])
      rmSync(root, { recursive: true, force: true });
  });
  assert.match(
    check(stale)[0],
    /excludes @soundor\/config 0\.17\.0, which its tests run with/,
  );
  assert.match(
    check(open)[0],
    /includes @soundor\/config 0\.17\.0, a line it has not been tested with/,
  );
  assert.match(check(malformed)[0], /not a version range/);
});
