import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, expect, test } from 'vitest';
import type { ViteUserConfig } from 'vitest/config';

import { soundor, type SoundorOptions } from './index';
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function configure(
  options: SoundorOptions = {},
  config: ViteUserConfig = { test: { environment: 'soundor' } },
) {
  const root = await mkdtemp(resolve(tmpdir(), 'soundor-config-'));
  directories.push(root);
  const plugin = soundor(options);
  const hook = plugin.config;
  if (typeof hook !== 'function') throw new Error('Expected config hook');
  const result = await hook.call(
    {} as never,
    { ...config, root },
    { command: 'serve', mode: 'test', isSsrBuild: false, isPreview: false },
  );
  return { plugin, result, root };
}
test('only applies to the test dev server', async () => {
  const { plugin, result } = await configure({}, {});
  expect(plugin.apply).toBe('serve');
  expect(result).toBeUndefined();
});
test('rejects a missing Soundor environment', async () => {
  await expect(
    configure({}, { test: { environment: 'node' } }),
  ).rejects.toThrow('test.environment');
});
test('reports explicit missing configurations', async () => {
  await expect(configure({ config: 'missing.ts' })).rejects.toThrow(
    'Config file does not exist',
  );
});
test('generates the actual shared contracts for a library project', async () => {
  const { result, root } = await configure({
    config: false,
    runtime: {
      parameters: [
        {
          id: 'gain',
          label: 'Gain',
          type: 'float',
          min: 0,
          max: 1,
          default: 0.5,
        },
      ],
    },
  });
  expect(result?.test?.environmentOptions?.soundor).toMatchObject({
    configured: true,
  });
  const text = await readFile(
    resolve(root, '.soundor/generated/parameters.d.ts'),
    'utf8',
  );
  expect(text).toContain('readonly gain: Parameter<number');
});
test('loads a project configuration without a native engine', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'soundor-project-'));
  directories.push(root);
  const config = resolve(root, 'soundor.config.ts');
  await writeFile(
    config,
    `export default {plugin: {id: 'com.test.plugin', name: 'Example'}, parameters: [{id: 'enabled', label: 'Enabled', type: 'bool', default: true}], runtimes: [], native: {methods: {probe: {returns: 'number'}}}};`,
  );
  const { result } = await configure({ config });
  expect(result?.test?.environmentOptions?.soundor).toMatchObject({
    runtime: {
      plugin: { id: 'com.test.plugin', name: 'Example' },
      parameters: [{ id: 'enabled', default: true }],
    },
  });
  expect(
    await readFile(resolve(root, '.soundor/generated/native.d.ts'), 'utf8'),
  ).toContain('function probe');
});
test('malformed project configurations are reported', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'soundor-invalid-'));
  directories.push(root);
  const config = resolve(root, 'soundor.config.ts');
  await writeFile(config, 'export default {plugin: {id: "invalid"}};');
  await expect(configure({ config })).rejects.toThrow('Invalid');
});

test('requires file isolation', async () => {
  await expect(
    configure({}, { test: { environment: 'soundor', isolate: false } }),
  ).rejects.toThrow('test.isolate');
});
test('unknown Soundor modules fail clearly', async () => {
  const { plugin } = await configure({ config: false });
  if (typeof plugin.resolveId !== 'function')
    throw new Error('Expected resolver');
  const resolveId = plugin.resolveId;
  expect(() =>
    resolveId.call({} as never, 'soundor:unknown', undefined, {
      isEntry: false,
    }),
  ).toThrow('Unsupported Soundor test module');
});
