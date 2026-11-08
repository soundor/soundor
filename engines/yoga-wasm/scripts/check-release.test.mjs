import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  builtProblem,
  namesPackage,
  releaseProblem,
} from './check-release.mjs';

const state = {
  sameInputs: false,
  published: '0.1.0',
  version: '0.1.0',
  changeset: false,
};

test('passes when the published module is this one', () => {
  assert.equal(releaseProblem({ ...state, sameInputs: true }), null);
});

test('fails when the inputs changed and nothing will publish them', () => {
  assert.match(releaseProblem(state), /add a changeset/);
});

test('passes when a changeset will publish them', () => {
  assert.equal(releaseProblem({ ...state, changeset: true }), null);
});

test('passes when a release pull request has versioned them', () => {
  assert.equal(releaseProblem({ ...state, version: '0.2.0' }), null);
});

test('passes when the first release pull request has consumed its changeset', () => {
  assert.equal(
    releaseProblem({ ...state, published: null, version: '0.1.0' }),
    null,
  );
});

test('fails before the first version bump with no changeset', () => {
  assert.match(
    releaseProblem({ ...state, published: null, version: '0.0.0' }),
    /add a changeset/,
  );
});

test('passes before the first version bump with a pending changeset', () => {
  assert.equal(
    releaseProblem({
      ...state,
      published: null,
      version: '0.0.0',
      changeset: true,
    }),
    null,
  );
});

test('packs only what was compiled for a release, from these inputs', () => {
  const build = { source: 'release', fingerprint: 'a' };
  assert.equal(builtProblem(build, 'a'), null);
  assert.match(
    builtProblem({ ...build, source: 'cache' }, 'a'),
    /came from cache/,
  );
  assert.match(builtProblem({ ...build, source: 'npm' }, 'a'), /came from npm/);
  assert.match(builtProblem(build, 'b'), /other inputs/);
});

test('reads only a changeset front matter', () => {
  assert.equal(
    namesPackage("---\n'@soundor/yoga-wasm': minor\n---\n\nText.\n"),
    true,
  );
  assert.equal(namesPackage("---\n'@soundor/react': minor\n---\n"), false);
  assert.equal(
    namesPackage(
      "---\n'@soundor/react': minor\n---\n\n'@soundor/yoga-wasm': no\n",
    ),
    false,
  );
});
