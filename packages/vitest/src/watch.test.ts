import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

test('watch mode reloads tests and Soundor configuration', async () => {
  const directory = await mkdtemp(
    fileURLToPath(new URL('../fixtures/watch-', import.meta.url)),
  );
  const reportFile = resolve(directory, 'results.json');
  const cli = resolve(
    dirname(fileURLToPath(import.meta.resolve('vitest/package.json'))),
    'vitest.mjs',
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST')),
  );
  const config = () =>
    `import {soundor} from '@soundor/vitest'; export default {plugins: [soundor()], test: {environment: 'soundor', include: ['watched.test.ts']}};`;
  const project = (value: number) =>
    `export default {plugin:{id:'com.test.watch',name:'Watch'}, runtimes:[], parameters:[{id:'gain',label:'Gain',type:'float',min:0,max:10,default:${value}}]};`;
  const source = (value: number) =>
    `import {test,expect} from 'vitest'; import {parameters} from 'soundor:parameters'; test('watch value', () => expect(parameters.gain.get()).toBe(${value}));`;
  await writeFile(resolve(directory, 'vitest.config.ts'), config());
  await writeFile(resolve(directory, 'soundor.config.ts'), project(1));
  await writeFile(resolve(directory, 'watched.test.ts'), source(1));
  const child = spawn(
    process.execPath,
    [cli, '--watch', '--reporter=json', `--outputFile=${reportFile}`],
    { cwd: directory, env, stdio: 'pipe' },
  );
  let diagnostics = '';
  child.stdout.on('data', (chunk) => {
    diagnostics += chunk;
  });
  child.stderr.on('data', (chunk) => {
    diagnostics += chunk;
  });
  const watcher = watch(directory);
  async function result(
    predicate: (report: {
      numPassedTests: number;
      numFailedTests: number;
    }) => boolean,
  ) {
    return new Promise<void>((resolveResult, reject) => {
      const timeout = setTimeout(() => {
        watcher.off('change', changed);
        reject(new Error(`Watch timed out: ${diagnostics}`));
      }, 15000);
      async function changed() {
        try {
          if (!predicate(JSON.parse(await readFile(reportFile, 'utf8'))))
            return;
          clearTimeout(timeout);
          watcher.off('change', changed);
          resolveResult();
        } catch {
          /* The reporter may still be writing. The next change retries. */
        }
      }
      watcher.on('change', changed);
      void changed();
    });
  }
  try {
    await result((report) => report.numPassedTests === 1);
    await rm(reportFile);
    await writeFile(resolve(directory, 'soundor.config.ts'), project(2));
    await result((report) => report.numFailedTests === 1);
    await rm(reportFile);
    await writeFile(resolve(directory, 'watched.test.ts'), source(2));
    await result((report) => report.numPassedTests === 1);
    expect(child.exitCode).toBeNull();
  } finally {
    watcher.close();
    if (child.exitCode === null) {
      const stopped = new Promise<void>((resolveStopped) =>
        child.once('exit', () => resolveStopped()),
      );
      child.kill('SIGTERM');
      await stopped;
    }
    await rm(directory, { recursive: true, force: true });
  }
}, 55000);
