import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type PluginLogEntry, parseLogLine, tailLog } from './log-tail';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'soundor-log-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const line = (level: string, message: string): string =>
  `${JSON.stringify({ level, source: 'Basic', message })}\n`;

describe('parseLogLine', () => {
  it('accepts entries and rejects anything else', () => {
    expect(parseLogLine(line('warn', 'careful').trim())).toEqual({
      level: 'warn',
      source: 'Basic',
      message: 'careful',
    });
    expect(parseLogLine('not json')).toBeUndefined();
    expect(
      parseLogLine('{"level":"loud","source":"a","message":"b"}'),
    ).toBeUndefined();
    expect(parseLogLine('{"level":"info","source":"a"}')).toBeUndefined();
    expect(parseLogLine('null')).toBeUndefined();
  });
});

describe('tailLog', () => {
  it('follows new entries only, across partial lines and truncation', async () => {
    const file = join(dir, 'ui.log');
    await writeFile(file, line('info', 'from before'));
    const entries: PluginLogEntry[] = [];
    const tail = await tailLog(file, (entry) => entries.push(entry), 10_000);
    try {
      await appendFile(file, line('info', 'one') + '{"level":"error","sou');
      await tail.poll();
      expect(entries.map((entry) => entry.message)).toEqual(['one']);

      await appendFile(file, 'rce":"Basic","message":"two ✓"}\n');
      await tail.poll();
      expect(entries.map((entry) => entry.message)).toEqual(['one', 'two ✓']);
      expect(entries[1]!.level).toBe('error');

      await writeFile(file, line('debug', 'after truncation'));
      await tail.poll();
      expect(entries.at(-1)!.message).toBe('after truncation');
    } finally {
      tail.close();
    }
  });

  it('waits for a file that does not exist yet', async () => {
    const file = join(dir, 'later.log');
    const entries: PluginLogEntry[] = [];
    const tail = await tailLog(file, (entry) => entries.push(entry), 10_000);
    try {
      await tail.poll();
      await writeFile(file, line('info', 'hello'));
      await tail.poll();
      expect(entries.map((entry) => entry.message)).toEqual(['hello']);
    } finally {
      tail.close();
    }
  });
});
