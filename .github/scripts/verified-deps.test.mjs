import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  dependencyKey,
  findDependencies,
  restoreDependencies,
  verificationArgs,
} from './verified-deps.mjs';

const repository = 'soundor/soundor';
const commit = 'a'.repeat(40);
const key = dependencyKey('windows', 'MSVC 19.44;SDK 26100', [
  ['recipe', 'source'],
]);
const now = Date.parse('2026-11-07T12:00:00Z');
const artifact = {
  id: 456,
  name: key,
  expired: false,
  created_at: new Date(now - 1000).toISOString(),
  expires_at: new Date(now + 86400000).toISOString(),
  digest: 'sha256:' + 'b'.repeat(64),
  workflow_run: { id: 123, head_sha: commit },
};
const run = {
  conclusion: 'success',
  status: 'completed',
  head_branch: 'main',
  head_repository: { full_name: repository },
  event: 'push',
  path: '.github/workflows/release.yml',
  head_sha: commit,
};
const response = (value, status = 200) =>
  new Response(JSON.stringify(value), { status });
function find({ artifacts = [artifact], workflow = run, fetcher } = {}) {
  return findDependencies(key, {
    repository,
    token: 'fixture',
    now,
    fetcher:
      fetcher ??
      (async (url) =>
        response(
          url.includes('/actions/artifacts?') ? { artifacts } : workflow,
        )),
  });
}

test('dependency identity binds family, compiler/SDK and exact recipes', () => {
  assert.equal(
    key,
    dependencyKey('windows', 'MSVC 19.44;SDK 26100', [['recipe', 'source']]),
  );
  assert.notEqual(
    key,
    dependencyKey('windows-static', 'MSVC 19.44;SDK 26100', [
      ['recipe', 'source'],
    ]),
  );
  assert.notEqual(
    key,
    dependencyKey('windows', 'MSVC 19.45;SDK 26100', [['recipe', 'source']]),
  );
  assert.notEqual(
    key,
    dependencyKey('windows', 'MSVC 19.44;SDK 26100', [
      ['recipe', 'other source'],
    ]),
  );
  assert.equal(
    dependencyKey('windows', 'compiler', [
      ['a', 'x\r\ny'],
      ['b', 'z'],
    ]),
    dependencyKey('windows', 'compiler', [
      ['b', 'z'],
      ['a', 'x\ny'],
    ]),
  );
  assert.throws(() => dependencyKey('unknown', 'compiler', []), /Unknown/);
});

test('only successful main release workflows with unexpired matching artifact digests are candidates', async () => {
  assert.deepEqual(await find(), {
    id: artifact.id,
    commit,
    digest: artifact.digest,
  });
  for (const patch of [
    { event: 'pull_request' },
    { head_branch: 'feature' },
    { conclusion: 'failure' },
    { status: 'in_progress' },
    { path: '.github/workflows/other.yml' },
    { head_repository: { full_name: 'attacker/fork' } },
    { head_sha: 'c'.repeat(40) },
  ])
    assert.equal(await find({ workflow: { ...run, ...patch } }), null);
  for (const patch of [
    { name: 'other-key' },
    { expired: true },
    { digest: null },
    { expires_at: new Date(now).toISOString() },
    { created_at: new Date(now - 8 * 86400000).toISOString() },
  ])
    assert.equal(await find({ artifacts: [{ ...artifact, ...patch }] }), null);
});

test('a miss selects a clean build; service and permission failures fail closed', async () => {
  assert.equal(await find({ artifacts: [] }), null);
  assert.equal(await find({ fetcher: async () => response({}, 404) }), null);
  for (const code of [403, 429, 500])
    await assert.rejects(
      find({ fetcher: async () => response({}, code) }),
      new RegExp(`HTTP ${code}`),
    );
});

test('verification restricts the repository, reusable signer, source ref and both commit digests', () => {
  const args = verificationArgs('archive', 'bundle', repository, commit);
  for (const [flag, value] of [
    ['--repo', repository],
    ['--signer-workflow', `${repository}/.github/workflows/engine.yml`],
    ['--source-ref', 'refs/heads/main'],
    ['--source-digest', commit],
    ['--signer-digest', commit],
  ])
    assert.equal(args[args.indexOf(flag) + 1], value);
  assert.ok(args.includes('--deny-self-hosted-runners'));
});

async function restoration(execute, digest) {
  const directory = mkdtempSync(join(tmpdir(), 'verified-deps-'));
  const transport = Buffer.from('opaque unsigned transport fixture');
  try {
    await restoreDependencies({
      candidate: {
        id: 456,
        commit,
        digest:
          digest ??
          'sha256:' + createHash('sha256').update(transport).digest('hex'),
      },
      identity: { key },
      directory,
      cache: join(directory, 'cache'),
      repository,
      token: 'fixture',
      fetcher: async () => new Response(transport),
      execute,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('native archive is not unpacked before signature verification, and signature failure stops all use', async () => {
  const calls = [];
  await assert.rejects(
    restoration((program, args) => {
      calls.push([program, args]);
      if (program === 'gh') throw new Error('signature rejected');
    }),
    /signature rejected/,
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1][1], 'unwrap');
  assert.equal(calls[1][0], 'gh');
  assert.ok(!calls.some(([, args]) => args.includes('unpack')));
});

test('transport digest mismatch stops even wrapper extraction', async () => {
  await assert.rejects(
    restoration(
      () => {
        throw new Error('must not execute');
      },
      'sha256:' + '0'.repeat(64),
    ),
    /digest mismatch/,
  );
});

test('verified archive is unpacked with the expected build identity', async () => {
  const calls = [];
  await restoration((program, args) => {
    calls.push([program, args]);
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[1][0], 'gh');
  assert.equal(calls[2][1][1], 'unpack');
  assert.equal(calls[2][1].at(-1), key);
});
