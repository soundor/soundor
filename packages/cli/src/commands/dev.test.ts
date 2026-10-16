import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ArgsDef, CommandMeta } from 'citty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { devCommand, runDev } from './dev';

vi.mock('../devtools/open', () => ({ openDevTools: vi.fn(async () => {}) }));

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
    vi.unstubAllEnvs();
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

  it('prints a summary when the runtime is ready and logs its build', async () => {
    await writeConfig(root, { ready: true });

    await runDev({ cwd: root, runtime: 'test' });

    const summary = info.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .find((text: string) => text.includes('SOUNDOR'));
    expect(summary).toMatch(/dev · test {2}ready in \d/);
    expect(summary).toContain('➜  Plugin:  Test\n');
    expect(summary).toContain('➜  Built:   yes\n');
    expect(summary).not.toContain('press h');
    expect(
      await readFile(join(root, '.soundor', 'dev', 'build.log'), 'utf8'),
    ).toBe('[1/1] Linking\n');
  });

  it('fails fast for an unknown runtime before gen', async () => {
    await writeConfig(root);

    await expect(runDev({ cwd: root, runtime: 'missing' })).rejects.toThrow(
      "No runtime registered for id 'missing'. Known runtimes: test.",
    );

    expect(globalThis.__soundorDevEvents).toEqual([]);
  });

  it('resolves supported settings before gen and preserves disabled development', async () => {
    await writeConfig(root, { devtools: true, checkDevTools: true });
    const path = join(root, 'user.json');
    await writeFile(path, '{"devtools":{"port":9000,"open":true}}');
    await expect(
      runDev({ cwd: root, runtime: 'test', userConfig: { path } }),
    ).resolves.toMatchObject({
      devtools: { enabled: true, port: 9000, open: true, portSource: 'config' },
    });
    expect(globalThis.__soundorDevEvents).toEqual([
      'gen:debug',
      'dev:debug',
      'devtools:true',
    ]);
    globalThis.__soundorDevEvents = [];
    await writeFile(path, '{"devtools":{"enabled":false}}');
    await expect(
      runDev({ cwd: root, runtime: 'test', userConfig: { path } }),
    ).resolves.toEqual({ runtime: 'test' });
    expect(globalThis.__soundorDevEvents).toEqual([
      'gen:debug',
      'dev:debug',
      'devtools:false',
    ]);
    globalThis.__soundorDevEvents = [];
    await writeFile(path, '{"devtools":{"port":0}}');
    await expect(
      runDev({ cwd: root, runtime: 'test', userConfig: { path } }),
    ).rejects.toThrow('Invalid Soundor user config');
    expect(globalThis.__soundorDevEvents).toEqual([]);
    await writeConfig(root);
    await expect(
      runDev({ cwd: root, runtime: 'test', userConfig: { path } }),
    ).resolves.toEqual({ runtime: 'test' });
  });

  it('opts into exactly one Vite origin while keeping the default origin restrictions', async () => {
    await writeConfig(root, {
      devtools: true,
      browserOrigin: 'http://127.0.0.1:5173',
    });
    const path = join(root, 'user.json');
    await writeFile(path, '{"devtools":{"open":false}}');
    vi.stubEnv('SOUNDOR_DEVTOOLS_ORIGIN', undefined);
    await runDev({ cwd: root, runtime: 'test', userConfig: { path } });
    expect(globalThis.__soundorDevEvents).toContain('browser-origin:403');
    globalThis.__soundorDevEvents = [];
    vi.stubEnv('SOUNDOR_DEVTOOLS_ORIGIN', 'http://127.0.0.1:5173');
    await runDev({ cwd: root, runtime: 'test', userConfig: { path } });
    expect(globalThis.__soundorDevEvents).toContain('browser-origin:200');
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
    vi.unstubAllEnvs();
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
  options: {
    abortOnDev?: boolean;
    ready?: boolean;
    logFromPlugin?: boolean;
    devtools?: boolean;
    checkDevTools?: boolean;
    browserOrigin?: string;
  } = {},
): Promise<void> {
  await writeFile(
    join(root, 'soundor.config.ts'),
    `import { defineSoundorConfig } from '@soundor/config';

const runtime = {
  id: 'test',
  ${options.devtools ? 'capabilities: { devtools: { inspector: true } },' : ''}
  async init() {},
  async gen(_config, ctx) {
    globalThis.__soundorDevEvents.push('gen:' + ctx.mode);
    ctx.codegen.emit({ path: 'runtime.txt', contents: 'generated\\n' });
  },
  async dev(_config, ctx) {
    globalThis.__soundorDevEvents.push('dev:' + ctx.mode);
    ctx.logger.info('runtime ready');
    if (${String(options.ready)}) {
      ctx.logger.pipe('[1/1] Linking');
      ctx.session.ready([{ label: 'Built', value: 'yes' }]);
    }
    if (${String(options.checkDevTools)}) globalThis.__soundorDevEvents.push('devtools:' + String(Boolean(ctx.devtools)));
    if (${JSON.stringify(options.browserOrigin)}) {
      const response = await fetch(ctx.devtools.endpoint + '/browser/session', {
        headers: { Origin: ${JSON.stringify(options.browserOrigin)} },
      });
      globalThis.__soundorDevEvents.push('browser-origin:' + response.status);
    }
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
