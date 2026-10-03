import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ArgsDef, CommandMeta } from 'citty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { devCommand, runDev } from './dev';

vi.mock('@clack/prompts', () => ({
  outro: vi.fn<() => void>(),
  spinner: vi.fn<() => { start: () => void; stop: (msg?: string) => void }>(
    () => ({
      start: vi.fn<() => void>(),
      stop: vi.fn<() => void>(),
    }),
  ),
}));

describe('dev command', () => {
  it('is defined', () => {
    expect(devCommand).toBeDefined();
  });

  it('has correct meta', () => {
    expect((devCommand.meta as CommandMeta)?.name).toBe('dev');
  });

  it('declares runtime as a required positional arg', () => {
    const args = devCommand.args as ArgsDef;
    expect(args['runtime']).toMatchObject({
      type: 'positional',
      required: true,
    });
  });
});

describe('runDev', () => {
  let root: string;
  let info: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    root = await mkdtemp(join(tmpdir(), 'soundor-cli-dev-'));
    info = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    globalThis.__soundorDevEvents = [];
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete globalThis.__soundorDevEvents;
    await rm(root, { recursive: true, force: true });
  });

  it('runs gen, then dispatches runtime dev', async () => {
    await writeConfig(root);

    await expect(runDev({ cwd: root, runtime: 'test' })).resolves.toEqual({
      runtime: 'test',
    });

    expect(globalThis.__soundorDevEvents).toEqual(['gen:debug', 'dev:debug']);
    expect(info).toHaveBeenCalledWith('[soundor:test] runtime ready');
  });

  it('fails fast for an unknown runtime before gen', async () => {
    await writeConfig(root);

    await expect(runDev({ cwd: root, runtime: 'missing' })).rejects.toThrow(
      "No runtime registered for id 'missing'. Known runtimes: test.",
    );

    expect(globalThis.__soundorDevEvents).toEqual([]);
  });

  it('aborts runtime dev on SIGINT', async () => {
    await writeConfig(root, { abortOnDev: true });

    await runDev({ cwd: root, runtime: 'test' });

    expect(globalThis.__soundorDevEvents).toEqual([
      'gen:debug',
      'dev:debug',
      'aborted:true',
    ]);
  });
});

declare global {
  // eslint-disable-next-line no-var
  var __soundorDevEvents: string[] | undefined;
}

async function writeConfig(
  root: string,
  options: { abortOnDev?: boolean } = {},
): Promise<void> {
  await writeFile(
    join(root, 'soundor.config.ts'),
    `import { defineSoundorConfig } from '@soundor/config';

const runtime = {
  id: 'test',
  async init() {},
  async gen(_config, ctx) {
    globalThis.__soundorDevEvents.push('gen:' + ctx.mode);
    ctx.codegen.emit({ path: 'runtime.txt', contents: 'generated\\n' });
  },
  async dev(_config, ctx) {
    globalThis.__soundorDevEvents.push('dev:' + ctx.mode);
    ctx.logger.info('runtime ready');
    if (${String(options.abortOnDev)}) {
      process.emit('SIGINT');
      globalThis.__soundorDevEvents.push('aborted:' + String(ctx.signal.aborted));
    }
  },
  async build() {},
  async doctor() {
    return { checks: [] };
  },
};

export default defineSoundorConfig({
  runtimes: [{ id: 'test', options: {}, runtime }],
  parameters: [],
  plugin: { id: 'com.example.test', name: 'Test' },
});
`,
    'utf8',
  );
}
