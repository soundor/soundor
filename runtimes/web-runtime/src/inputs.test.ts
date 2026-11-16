import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createServer, type ViteDevServer } from 'vite';
import { expect, it, vi } from 'vitest';

import { webBuild, webDev, webGen } from './index';
import {
  makeCtx,
  SOURCE_CLIENT_DIR,
  tempProject,
  testConfig,
  writeGenerated,
} from './testing';

async function project(inputs?: string) {
  const root = await tempProject();
  const ctx = makeCtx(root, { mode: 'production', options: { inputs } });
  await webGen(testConfig, ctx);
  await writeGenerated(ctx);
  await mkdir(join(root, 'web'), { recursive: true });
  return { root, ctx };
}

async function output(dir: string): Promise<string> {
  const entries = await readdir(dir, { recursive: true });
  return (
    await Promise.all(
      entries
        .filter((file) => file.endsWith('.js'))
        .map((file) => readFile(join(dir, file), 'utf8')),
    )
  ).join('\n');
}

it.each(['ts', 'js'])(
  'bundles a browser %s module, local imports, npm imports and built-in composition',
  async (extension) => {
    const { root, ctx } = await project(`./web/inputs.${extension}`);
    const dependency = join(root, 'node_modules/browser-source');
    await mkdir(dependency, { recursive: true });
    await writeFile(
      join(dependency, 'package.json'),
      JSON.stringify({
        name: 'browser-source',
        type: 'module',
        exports: './index.js',
      }),
    );
    await writeFile(
      join(dependency, 'index.js'),
      'export const label = "INSTALLED_BROWSER_DEPENDENCY";',
    );
    await writeFile(
      join(root, 'web/local.js'),
      'export const id = "LOCAL_INPUT_MODULE";',
    );
    await writeFile(
      join(root, `web/inputs.${extension}`),
      `
import { defineInput, audioFile, oscillator } from '@soundor/web-runtime/input';
import { label } from 'browser-source';
import { id } from './local.js';
// This is browser code. Node config loading must never evaluate it.
document.title = label;
export default [defineInput({ id, label, start({ context, destination }) {
  const source = context.createOscillator(); source.connect(destination); source.start();
  return () => { source.stop(); source.disconnect(); };
}}), audioFile(), oscillator({ frequency: 330 })];
`,
    );
    await webBuild(testConfig, ctx, { clientDir: SOURCE_CLIENT_DIR });
    const code = await output(ctx.paths.dist);
    expect(code).toContain('INSTALLED_BROWSER_DEPENDENCY');
    expect(code).toContain('LOCAL_INPUT_MODULE');
    expect(code).not.toMatch(/from\s*['"]browser-source/);
    expect(code).not.toContain(root);
  },
);

it.each(['missing.ts', 'web', 'web/inputs.txt'])(
  'reports an invalid entry %s relative to the plugin root',
  async (inputs) => {
    const { ctx } = await project(inputs);
    await expect(webBuild(testConfig, ctx)).rejects.toThrow(
      /Web input module not found or not JavaScript\/TypeScript/,
    );
  },
);

it.each([
  [
    'export const inputs = [];',
    /default.*not exported|Missing export|does not provide an export/s,
  ],
  [
    "import source from './missing.js'; export default source;",
    /Could not resolve.*missing/,
  ],
])('reports invalid browser imports/exports', async (source, message) => {
  const { root, ctx } = await project('./web/inputs.ts');
  await writeFile(join(root, 'web/inputs.ts'), source);
  await expect(
    webBuild(testConfig, ctx, { clientDir: SOURCE_CLIENT_DIR }),
  ).rejects.toThrow(message);
});

it('serves browser inputs with source maps and reloads after imported source changes', async () => {
  const { root } = await project('./web/inputs.ts');
  const path = join(root, 'web/inputs.ts');
  const local = join(root, 'web/label.ts');
  await writeFile(local, 'export const label: string = "BEFORE_INPUT_EDIT";');
  await writeFile(
    path,
    `import { label } from './label'; export default [{ id: 'custom', label, start() { return () => {}; } }];`,
  );
  const controller = new AbortController();
  let server: ViteDevServer | undefined;
  const running = webDev(
    testConfig,
    makeCtx(root, {
      options: { port: 0, inputs: './web/inputs.ts' },
      signal: controller.signal,
    }),
    {
      clientDir: SOURCE_CLIENT_DIR,
      createServer: async (config) => {
        server = await createServer(config);
        return server;
      },
    },
  );
  try {
    await vi.waitFor(() =>
      expect(server?.resolvedUrls?.local[0]).toBeDefined(),
    );
    const transformed = await server!.transformRequest(
      'soundor:internal/inputs',
    );
    expect(transformed?.code).toContain('custom');
    const map = transformed?.map;
    expect(
      map &&
        'sources' in map &&
        map.sources.some((source) => source.endsWith('inputs.ts')),
    ).toBe(true);
    await server!.transformRequest(`/@fs/${local}`);
    const send = vi.spyOn(server!.ws, 'send');
    await writeFile(local, 'export const label: string = "AFTER_INPUT_EDIT";');
    await vi.waitFor(() =>
      expect(
        send.mock.calls.some(
          ([message]) => (message as { type?: string }).type === 'full-reload',
        ),
      ).toBe(true),
    );
    expect((await server!.transformRequest(`/@fs/${local}`))?.code).toContain(
      'AFTER_INPUT_EDIT',
    );
  } finally {
    controller.abort();
    await running;
  }
});

it('bundles AudioWorklet scripts and their imports for the worklet environment', async () => {
  const { root, ctx } = await project('./web/inputs.ts');
  await writeFile(
    join(root, 'web/name.ts'),
    'export const name: string = "CUSTOM_BUNDLED_WORKLET";',
  );
  await writeFile(
    join(root, 'web/worklet.js'),
    `
import { name } from './name.ts';
class Source extends AudioWorkletProcessor { process(inputs, outputs) { outputs[0][0].fill(0.1); return true; } }
registerProcessor(name, Source);
`,
  );
  await writeFile(
    join(root, 'web/inputs.ts'),
    `
import url from './worklet.js?worker&url';
export default [{ id: 'worklet', label: 'Worklet', async start({ context, destination }) {
  await context.audioWorklet.addModule(url);
  const node = new AudioWorkletNode(context, 'CUSTOM_BUNDLED_WORKLET');
  node.connect(destination);
  return () => node.disconnect();
}}];
`,
  );
  await webBuild(testConfig, ctx, { clientDir: SOURCE_CLIENT_DIR });
  const files = await readdir(join(ctx.paths.dist, 'assets'));
  const worklet = files.find(
    (file) => file.startsWith('worklet-') && file.endsWith('.js'),
  );
  expect(worklet).toBeDefined();
  const source = await readFile(
    join(ctx.paths.dist, 'assets', worklet!),
    'utf8',
  );
  expect(source).toContain('registerProcessor');
  expect(source).toContain('CUSTOM_BUNDLED_WORKLET');
  expect(source).not.toContain('./name.ts');
});
