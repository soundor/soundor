import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ConfigError, locateConfig, parseConfig } from '@soundor/config';
import {
  describeNativeApi,
  generateSoundorFiles,
  createNodeFileSystem,
  writeGeneratedFiles,
  type NativeApiDeclaration,
} from '@soundor/core';
import {
  createTestRuntime,
  createUiModule,
  getTestRuntime as currentRuntime,
  type RuntimeOptions,
} from '@soundor/test-runtime';
import type {} from 'vitest';
import type { Plugin } from 'vitest/config';

declare module 'vitest' {
  interface Matchers<
    R extends void | Promise<void> = void | Promise<void>,
    T = unknown,
  > {
    toHaveFocus(): R;
  }
}

/** @deprecated Advanced escape hatch. Use Testing Library queries, matchers and setup helpers in application tests. */
export const getTestRuntime = currentRuntime;

export interface SoundorOptions {
  /** Discover soundor.config.ts, use an explicit path, or disable discovery for library tests. */
  config?: string | false;
  /** Deterministic initial state for each test. Native functions are configured with mockNative() from @soundor/testing-library. */
  runtime?: Omit<RuntimeOptions, 'native' | 'nativeMethods'>;
  /** Native declarations for tests without a project config. */
  native?: NativeApiDeclaration;
}
const prefix = '\0soundor:test:';
const modules = new Set([
  'ui',
  'parameters',
  'host',
  'native',
  'storage',
  'fs',
]);
// Virtual modules have no physical importer; resolve the transitive runtime from this package.
const runtimeModule = fileURLToPath(
  import.meta.resolve('@soundor/test-runtime'),
);
const setup = fileURLToPath(new URL('./setup.mjs', import.meta.url));

/** Resolve Soundor imports against the simulated runtime in Vitest. */
export function soundor(options: SoundorOptions = {}): Plugin {
  let enabled = false;
  let native: NativeApiDeclaration = options.native ?? {};
  let parameters: NonNullable<RuntimeOptions['parameters']> =
    options.runtime?.parameters ?? [];
  let configPath: string | undefined;
  return {
    name: 'soundor:vitest',
    apply: 'serve',
    async config(config) {
      if (!config.test) return;
      if (config.test.environment !== 'soundor')
        throw new Error(
          'soundor() requires test.environment: "soundor". Install vitest-environment-soundor as a direct devDependency.',
        );
      if (config.test.isolate === false)
        throw new Error(
          'Soundor testing requires test.isolate: true (the Vitest default).',
        );
      enabled = true;
      const projectRoot = resolve(config.root ?? process.cwd());
      let runtime: Omit<RuntimeOptions, 'native' | 'nativeMethods'> =
        options.runtime ?? {};
      if (options.config !== false) {
        // Discover once; malformed project configurations must never become empty defaults.
        try {
          configPath =
            typeof options.config === 'string'
              ? resolve(projectRoot, options.config)
              : locateConfig(projectRoot);
        } catch (error) {
          if (!(error instanceof ConfigError && error.kind === 'not-found'))
            throw error;
        }
        if (configPath) {
          const project = await parseConfig({ path: configPath });
          if (runtime.parameters || options.native)
            throw new Error(
              'Parameter and native declarations come from soundor.config.ts. Use config: false for library declarations, or Testing Library setup helpers in beforeEach to configure state and native mocks.',
            );
          native = project.native ?? {};
          parameters = project.parameters;
          runtime = { plugin: project.plugin, parameters, ...runtime };
        }
      }
      parameters = runtime.parameters ?? parameters;
      const generated = generateSoundorFiles({
        plugin: runtime.plugin ?? { id: 'soundor.test', name: 'Soundor Test' },
        parameters: parameters.map((parameter) =>
          parameter.type === 'enum'
            ? { ...parameter, values: [...parameter.values] }
            : parameter,
        ),
        native,
      });
      await writeGeneratedFiles(
        createNodeFileSystem(configPath ? dirname(configPath) : projectRoot),
        '.soundor/generated',
        generated,
      );
      return {
        oxc: { jsx: { runtime: 'automatic' } },
        test: {
          setupFiles: [setup],
          sequence: { setupFiles: 'list' },
          environmentOptions: {
            ...config.test.environmentOptions,
            soundor: {
              configured: true,
              runtime: {
                ...runtime,
                nativeMethods: Object.keys(native.methods ?? {}),
              },
            },
          },
          server: {
            deps: { inline: ['@soundor/react', '@soundor/testing-library'] },
          },
        },
      };
    },
    configResolved(config) {
      if (!enabled) return;
      const files = config.test.setupFiles ?? [];
      config.test.setupFiles = [
        setup,
        ...(Array.isArray(files) ? files : [files]).filter(
          (file) => file !== setup,
        ),
      ];
    },
    configureServer(server) {
      if (!enabled || !configPath) return;
      server.watcher.add(configPath);
      server.watcher.on('change', (path) => {
        if (path === configPath) void server.restart();
      });
    },
    resolveId(id) {
      if (!enabled || !id.startsWith('soundor:')) return;
      const name = id.slice(8);
      if (!modules.has(name))
        throw new Error(`Unsupported Soundor test module: ${id}`);
      return prefix + name;
    },
    load(id) {
      if (!id.startsWith(prefix)) return;
      return virtualModule(
        id.slice(prefix.length),
        parameters.map((p) => p.id),
        native,
      );
    },
  };
}

function virtualModule(
  name: string,
  ids: readonly string[],
  native: NativeApiDeclaration,
): string {
  const header = `import { getTestRuntime, createUiModule, subscribeTestRuntime, TestNode, TestEvent } from ${JSON.stringify(runtimeModule)};\n`;
  if (name === 'ui') {
    const runtime = createTestRuntime();
    const module = createUiModule(runtime);
    const classes = [
      'UiNode',
      'PointerEvent',
      'KeyboardEvent',
      'InputEvent',
      'FocusEvent',
      'AccessibilityActionEvent',
      'WheelEvent',
    ];
    const functions = Object.entries(module)
      .filter(
        ([key, value]) => typeof value === 'function' && !classes.includes(key),
      )
      .map(
        ([key]) =>
          `export const ${key} = (...args) => currentUi().${key}(...args);`,
      );
    runtime.dispose();
    return (
      header +
      `export let root, overlayRoot;\nlet ui;\nconst currentUi = () => { getTestRuntime(); return ui; };\nsubscribeTestRuntime(runtime => { ui = createUiModule(runtime); root = ui.root; overlayRoot = ui.overlayRoot; });\nexport { TestNode as UiNode, ${classes
        .slice(1)
        .map((key) => `TestEvent as ${key}`)
        .join(
          ', ',
        )} };\n${functions.join('\n')}\nexport const clipboard = { readText: () => getTestRuntime().clipboard.readText(), writeText: text => getTestRuntime().clipboard.writeText(text) };`
    );
  }
  if (name === 'parameters')
    return (
      header +
      `export const parameters = Object.freeze(Object.fromEntries(${JSON.stringify(ids)}.map(id => [id, new Proxy({}, { get(_, key) { const parameter = getTestRuntime().parameters.byId[id]; const value = parameter[key]; return typeof value === 'function' ? (...args) => getTestRuntime().parameters.byId[id][key](...args) : value; } })])));`
    );
  if (name === 'host')
    return (
      header +
      `export const plugin = new Proxy({}, { get: (_, key) => getTestRuntime().plugin[key], ownKeys: () => ['id', 'name'], getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true }) });\nexport const snapshot = () => getTestRuntime().snapshot();\nexport const subscribe = listener => getTestRuntime().subscribe(listener);`
    );
  if (name === 'storage')
    return (
      header +
      `export const storage = { ${['get', 'set', 'delete', 'keys', 'clear'].map((key) => `${key}: (...args) => getTestRuntime().storage.${key}(...args)`).join(', ')} };`
    );
  if (name === 'native') {
    const result = describeNativeApi(native);
    if (!result.ok)
      throw new Error(
        'Invalid Soundor native declaration: ' + JSON.stringify(result.issues),
      );
    return (
      header +
      result.model.methods
        .map(
          (method) =>
            `export ${method.async ? 'async ' : ''}function ${method.name}(...args) { return getTestRuntime().callNative(${JSON.stringify(method.name)}, args); }`,
        )
        .join('\n')
    );
  }
  return [
    'readBytes',
    'readText',
    'writeBytes',
    'writeText',
    'readDir',
    'mkdir',
    'remove',
    'stat',
    'exists',
  ]
    .map(
      (key) =>
        `export async function ${key}() { throw new Error('soundor:fs.${key} is unavailable in the simulated runtime; use soundor:storage or vi.mock("soundor:fs")'); }`,
    )
    .join('\n');
}
