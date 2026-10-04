import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

describe('runDev with a UI', () => {
  let root: string;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'soundor-cli-dev-ui-'));
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
    globalThis.__soundorDevEvents = [];
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete globalThis.__soundorDevEvents;
    await rm(root, { recursive: true, force: true });
  });

  it('serves a live bundle and shows the plugin log with source-mapped stacks', async () => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(
      join(root, 'src/main.ts'),
      "const reason: string = 'boom';\nthrow new Error(reason);\n",
    );
    await writeConfig(root, { logFromPlugin: true });

    await runDev({ cwd: root, runtime: 'test' });

    expect(globalThis.__soundorDevEvents).toEqual([
      'gen:debug',
      'dev:debug',
      'ui:bundle.js:live',
    ]);
    expect(error).toHaveBeenCalledWith(
      '[soundor:ui] Test: Error: boom\n    at <eval> (src/main.ts:2:1)',
    );
  });
});

declare global {
  // eslint-disable-next-line no-var
  var __soundorDevEvents: string[] | undefined;
}

async function writeConfig(
  root: string,
  options: { abortOnDev?: boolean; logFromPlugin?: boolean } = {},
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
    if (${String(options.logFromPlugin)}) {
      // Plays the plugin: logs an error thrown at the bundle's \`throw\`.
      const fs = await import('node:fs');
      globalThis.__soundorDevEvents.push(
        'ui:' + ctx.ui.entry + ':' + (ctx.ui.live ? 'live' : 'embedded'),
      );
      const lines = fs.readFileSync(ctx.ui.dir + '/' + ctx.ui.entry, 'utf8').split('\\n');
      const line = lines.findIndex((text) => text.includes('throw'));
      const frame = '/bundle.js:' + (line + 1) + ':' + (lines[line].indexOf('throw') + 1);
      fs.appendFileSync(
        ctx.ui.live.logFile,
        JSON.stringify({ level: 'error', source: 'Test', message: 'Error: boom\\n    at <eval> (' + frame + ')' }) + '\\n',
      );
    }
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
