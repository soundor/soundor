import { execFile } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { expect, test } from 'vitest';

const exec = promisify(execFile);
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST')),
);
const cli = resolve(
  dirname(fileURLToPath(import.meta.resolve('vitest/package.json'))),
  'vitest.mjs',
);
const fixture = fileURLToPath(
  new URL('../fixtures/integration', import.meta.url),
);

/** A real Vitest run of the fixture project, as a user's would be. */
async function run(args: string[]) {
  const directory = await mkdtemp(resolve(tmpdir(), 'soundor-vitest-e2e-'));
  const output = resolve(directory, 'results.json');
  try {
    let code = 0;
    let stderr = '';
    try {
      const result = await exec(
        process.execPath,
        [cli, 'run', '--reporter=json', `--outputFile=${output}`, ...args],
        { cwd: fixture, env: { ...env, FORCE_COLOR: '0' }, timeout: 30_000 },
      );
      stderr = result.stderr;
    } catch (error) {
      ({ code, stderr } = error as { code: number; stderr: string });
    }
    const report = await readFile(output, 'utf8').then(
      (text) => JSON.parse(text) as Record<string, number>,
      () => undefined,
    );
    return { code, stderr, report };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('runs beside the simulated runtime, in one config', async () => {
  const { code, report, stderr } = await run([]);
  expect(stderr).toBe('');
  expect(code).toBe(0);
  expect(report?.['numPassedTests']).toBe(5);
}, 35_000);

test('a missing bundle fails once, naming how to build it', async () => {
  const { code, stderr } = await run(['--config', 'missing.config.ts']);
  expect(code).not.toBe(0);
  expect(stderr).toContain('Missing.vst3');
  expect(stderr).toContain('soundor dev juce');
  expect(stderr.match(/does not exist/g)).toHaveLength(1);
}, 35_000);

test('a missing bundle does not stop the other project', async () => {
  const { code, report } = await run([
    '--config',
    'missing.config.ts',
    '--project',
    'integration',
  ]);
  expect(code).toBe(0);
  expect(report?.['numPassedTests']).toBe(1);
}, 35_000);

test('refuses the simulated runtime', async () => {
  const { code, stderr } = await run(['--config', 'simulated.config.ts']);
  expect(code).not.toBe(0);
  expect(stderr).toContain('End-to-end tests run in Node');
}, 35_000);

test('without the plugin, launching says what is missing', async () => {
  const { code, report } = await run(['--config', 'unconfigured.config.ts']);
  expect(code).toBe(0);
  expect(report?.['numPassedTests']).toBe(1);
}, 35_000);
