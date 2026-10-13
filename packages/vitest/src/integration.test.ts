import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
async function run(config?: string, args: string[] = []) {
  const directory = await mkdtemp(resolve(tmpdir(), 'soundor-vitest-'));
  const output = resolve(directory, 'results.json');
  try {
    let code = 0;
    try {
      await exec(
        process.execPath,
        [
          cli,
          'run',
          '--reporter=json',
          `--outputFile=${output}`,
          ...(config ? ['--config', config] : []),
          ...args,
        ],
        {
          cwd: fileURLToPath(
            new URL('../fixtures/integration', import.meta.url),
          ),
          env: { ...env, FORCE_COLOR: '0' },
          timeout: 30000,
        },
      );
    } catch (error) {
      code = (error as { code: number }).code;
    }
    return { code, report: JSON.parse(await readFile(output, 'utf8')) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
test('runs virtual modules and the real React renderer in parallel isolated files', async () => {
  const { code, report } = await run();
  expect(code).toBe(0);
  expect(report.numPassedTests).toBe(4);
}, 35000);
test('tears down after a failing test', async () => {
  const { code, report } = await run('failure.config.ts');
  expect(code).toBe(1);
  expect(report.numFailedTests).toBe(1);
  expect(report.numPassedTests).toBe(1);
  expect(JSON.stringify(report)).toContain('intentional test failure');
}, 35000);

test('runs sequential files in a single worker without stale bindings', async () => {
  const { code, report } = await run(undefined, ['--maxWorkers=1']);
  expect(code).toBe(0);
  expect(report.numPassedTests).toBe(4);
}, 35000);
