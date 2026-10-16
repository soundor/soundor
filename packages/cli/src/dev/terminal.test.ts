import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { createDevTerminal, formatSummary } from './terminal';

let dir: string;
let output: PassThrough & { columns?: number; isTTY?: boolean };
let written: string;
let info: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
let pipe: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'soundor-cli-terminal-'));
  output = Object.assign(new PassThrough(), { columns: 40 });
  written = '';
  output.on('data', (chunk: Buffer) => (written += chunk.toString()));
  info = vi.spyOn(console, 'info').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
  pipe = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

it('collapses child-process output into one progress line, keeping all of it in the log', async () => {
  const buildLog = join(dir, 'build.log');
  const terminal = createDevTerminal({
    scope: 'soundor',
    buildLog,
    collapse: true,
    output: output as never,
  });
  const logger = terminal.logger.child('juce');

  logger.pipe('[1/2] Building CXX object with a rather long name.o');
  logger.pipe('[2/2] Linking');
  logger.info('Debug build ready.');
  terminal.settle();
  terminal.flush();
  await terminal.close();

  expect(pipe).not.toHaveBeenCalled();
  expect(written).toBe(
    '\r\x1b[2K… [1/2] Building CXX object with a rat…' +
      '\r\x1b[2K… [2/2] Linking' +
      '\r\x1b[2K',
  );
  expect(info).toHaveBeenCalledWith('[soundor:juce] Debug build ready.');
  // Settled output is not printed again when something fails later.
  expect(error).not.toHaveBeenCalled();
  expect(await readFile(buildLog, 'utf8')).toBe(
    '[1/2] Building CXX object with a rather long name.o\n[2/2] Linking\n',
  );
});

it('prints the collapsed output when the build fails', async () => {
  const buildLog = join(dir, 'build.log');
  const terminal = createDevTerminal({
    scope: 'soundor',
    buildLog,
    collapse: true,
    output: output as never,
  });

  terminal.logger.pipe('FAILED: main.o\nerror: expected ;', 'stdout');
  terminal.flush();
  await terminal.close();

  expect(error).toHaveBeenCalledWith('FAILED: main.o\nerror: expected ;');
  expect(error).toHaveBeenCalledWith(
    `[soundor] The full build output is in ${buildLog}`,
  );
});

it('prints child-process output as is outside a terminal', async () => {
  const terminal = createDevTerminal({
    scope: 'soundor',
    buildLog: join(dir, 'build.log'),
    collapse: false,
    output: output as never,
  });

  terminal.logger.pipe('-- Configuring done');
  await terminal.close();

  expect(pipe).toHaveBeenCalledWith('-- Configuring done');
  expect(written).toBe('');
});

it('formats the summary with aligned labels', () => {
  expect(
    formatSummary({
      version: '1.2.3',
      runtime: 'juce',
      readyMs: 41_830,
      rows: [
        { label: 'Plugin', value: 'Gain' },
        { label: 'DevTools', value: 'http://localhost:4545' },
      ],
      hint: true,
      output: output as never,
    }),
  ).toBe(
    [
      '',
      '  SOUNDOR  v1.2.3  dev · juce  ready in 41.8 s',
      '',
      '  ➜  Plugin:    Gain',
      '  ➜  DevTools:  http://localhost:4545',
      '  ➜  press h + enter to show help',
      '',
    ].join('\n'),
  );
  expect(
    formatSummary({
      runtime: 'web',
      rows: [{ label: 'Plugin', value: 'Gain' }],
      hint: false,
      output: output as never,
    }),
  ).toBe('\n  SOUNDOR  dev · web\n\n  ➜  Plugin:  Gain\n');
});
