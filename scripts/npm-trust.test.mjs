import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const matching = {
  type: 'github',
  repository: 'soundor/soundor',
  file: 'release.yml',
  permissions: ['createPackage'],
};

function check(
  t,
  { response = '', inspectExit = 0, publishExit = 0, preview = false },
) {
  const directory = mkdtempSync(join(tmpdir(), 'soundor-trust-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const calls = join(directory, 'calls.jsonl');
  writeFileSync(
    join(directory, 'npm'),
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.TRUST_TEST_CALLS, JSON.stringify(args) + '\\n');
if (args[0] === '--version') console.log('11.19.1');
else if (args[1] === 'list') {
  process.stdout.write(process.env.TRUST_TEST_RESPONSE);
  process.exit(Number(process.env.TRUST_TEST_INSPECT_EXIT));
} else process.exit(Number(process.env.TRUST_TEST_PUBLISH_EXIT));
`,
    { mode: 0o755 },
  );
  const result = spawnSync(
    process.execPath,
    [
      'scripts/npm-trust.mjs',
      ...(preview ? [] : ['--apply']),
      '@soundor/react',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: directory + delimiter + process.env.PATH,
        TRUST_TEST_CALLS: calls,
        TRUST_TEST_RESPONSE: response,
        TRUST_TEST_INSPECT_EXIT: String(inspectExit),
        TRUST_TEST_PUBLISH_EXIT: String(publishExit),
      },
    },
  );
  assert.ifError(result.error);
  let commands = [];
  try {
    commands = readFileSync(calls, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return {
    ...result,
    creates: commands.filter((args) => args[1] === 'github'),
    commands,
  };
}

// The fake executable uses a Unix shebang; the production script also supports Windows.
test(
  'trusted publishing CLI decisions',
  { skip: process.platform === 'win32' },
  async (t) => {
    for (const response of [
      JSON.stringify(matching, null, 2),
      JSON.stringify([matching]),
      JSON.stringify({ ...matching, repository: 'other/repo' }, null, 2) +
        '\n\n' +
        JSON.stringify(matching, null, 2),
    ]) {
      await t.test('matching publisher skips successfully', (t) => {
        const result = check(t, { response });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.creates.length, 0);
        assert.match(result.stdout, /already configured; skipped/);
      });
    }
    for (const change of [
      { repository: 'other/repo' },
      { file: 'other.yml' },
      { type: 'gitlab' },
      { environment: 'production' },
      { permissions: ['createStagedPackage'] },
      { permissions: undefined },
    ]) {
      await t.test('conflicting publisher is left intact', (t) => {
        const result = check(t, {
          response: JSON.stringify({ ...matching, ...change }),
        });
        assert.equal(result.status, 1);
        assert.equal(result.creates.length, 0);
        assert.match(result.stderr, /conflicting publisher/);
      });
    }
    for (const response of ['', '[]']) {
      await t.test('missing publisher is created', (t) => {
        const result = check(t, { response });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.creates.length, 1);
        assert.ok(result.creates[0].includes('--allow-publish'));
      });
    }
    await t.test('inspection failure does not create', (t) => {
      const result = check(t, { inspectExit: 1 });
      assert.equal(result.status, 1);
      assert.equal(result.creates.length, 0);
    });
    await t.test('malformed output does not create', (t) => {
      const result = check(t, { response: 'not JSON' });
      assert.equal(result.status, 1);
      assert.equal(result.creates.length, 0);
    });
    await t.test('creation failure is reported', (t) => {
      const result = check(t, { publishExit: 1 });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Failed packages/);
    });
    await t.test('preview does not invoke npm', (t) => {
      const result = check(t, { preview: true });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.commands.length, 0);
    });
  },
);
