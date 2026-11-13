import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ConfigError,
  locateConfig,
  parseConfig,
  resolveConfig,
  resolveEditor,
  type ParameterDeclarations,
} from '@soundor/config';
import {
  describeNativeApi,
  describeState,
  stateJson,
  type StateDeclarations,
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
import { defaultExternalConditions, defaultServerConditions } from 'vite';
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
  runtime?: Omit<
    RuntimeOptions,
    | 'native'
    | 'nativeMethods'
    | 'nativeEvents'
    | 'nativeChannels'
    | 'parameters'
    | 'state'
  > & {
    /** Parameter declarations for tests without a project config, as soundor.config declares them. */
    parameters?: ParameterDeclarations;
    /** Persistent declarations for tests without a project config. */
    state?: StateDeclarations;
  };
  /** Native declarations for tests without a project config. */
  native?: NativeApiDeclaration;
}
const prefix = '\0soundor:test:';
const modules = new Set([
  'ui',
  'parameters',
  'state',
  'state-history',
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
    options.runtime?.parameters === undefined
      ? []
      : resolveParameters(options.runtime.parameters);
  let state = options.runtime?.state ?? {};
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
      const {
        parameters: _declared,
        state: _state,
        ...given
      } = options.runtime ?? {};
      let runtime: Omit<
        RuntimeOptions,
        'native' | 'nativeMethods' | 'nativeEvents' | 'nativeChannels'
      > = {
        ...given,
        ...(options.runtime?.parameters !== undefined && { parameters }),
      };
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
          if (
            options.runtime?.parameters ||
            options.runtime?.state ||
            options.native
          )
            throw new Error(
              'Parameter, state and native declarations come from soundor.config.ts. Use config: false for library declarations, or Testing Library setup helpers in beforeEach to configure state and native mocks.',
            );
          native = project.native ?? {};
          state = project.state ?? {};
          parameters = project.parameters;
          // The view opens at the editor's size, as in the runtimes, and the
          // editor takes requests within its limits.
          const editor = project.editor && resolveEditor(project.editor);
          const view = editor && {
            width: editor.width,
            height: editor.height,
          };
          // An unbounded maximum is left out: these options go to the test
          // workers as JSON, which has no Infinity, and none is the default.
          const editorInit: RuntimeOptions['editor'] = editor && {
            width: editor.width,
            height: editor.height,
            resizable:
              editor.resizable &&
              (editor.minWidth < editor.maxWidth ||
                editor.minHeight < editor.maxHeight),
            minWidth: editor.minWidth,
            minHeight: editor.minHeight,
            ...(Number.isFinite(editor.maxWidth) && {
              maxWidth: editor.maxWidth,
            }),
            ...(Number.isFinite(editor.maxHeight) && {
              maxHeight: editor.maxHeight,
            }),
            aspectRatio:
              editor.resizable &&
              editor.resize === 'scale' &&
              editor.keepAspectRatio
                ? { width: editor.width, height: editor.height }
                : null,
          };
          runtime = {
            plugin: project.plugin,
            parameters,
            view,
            editor: editorInit,
            ...runtime,
          };
        }
      }
      parameters = runtime.parameters ?? parameters;
      runtime.state = JSON.parse(stateJson(describeState(state, native)));
      const generated = generateSoundorFiles({
        plugin: runtime.plugin ?? { id: 'soundor.test', name: 'Soundor Test' },
        parameters: parameters as never,
        native,
        state,
      });
      await writeGeneratedFiles(
        createNodeFileSystem(configPath ? dirname(configPath) : projectRoot),
        '.soundor/generated',
        generated,
      );
      return {
        oxc: { jsx: { runtime: 'automatic' } },
        ssr: {
          resolve: {
            conditions: [
              'soundor',
              ...(config.ssr?.resolve?.conditions ?? defaultServerConditions),
            ],
            externalConditions: [
              'soundor',
              ...(config.ssr?.resolve?.externalConditions ??
                defaultExternalConditions),
            ],
          },
        },
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
                nativeEvents: Object.keys(native.events ?? {}),
                nativeChannels: Object.keys(native.channels ?? {}),
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
        Object.keys(state),
      );
    },
  };
}

/** Library tests' declarations, resolved as a project's config is: JSON for the workers. */
function resolveParameters(
  declarations: ParameterDeclarations,
): NonNullable<RuntimeOptions['parameters']> {
  return JSON.parse(
    JSON.stringify(
      resolveConfig({
        plugin: { id: 'soundor.test', name: 'Soundor Test' },
        runtimes: [],
        parameters: declarations,
      }).parameters,
    ),
  ) as NonNullable<RuntimeOptions['parameters']>;
}

function virtualModule(
  name: string,
  ids: readonly string[],
  native: NativeApiDeclaration,
  stateIds: readonly string[],
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
  if (name === 'state-history')
    return `${header}export const stateHistory = Object.freeze({ ${['undo', 'redo', 'clear', 'canUndo', 'canRedo', 'undoLabel', 'redoLabel', 'snapshot', 'subscribe', 'transaction'].map((name) => `${name}: (...args) => getTestRuntime().history.${name}(...args)`).join(', ')} });`;
  if (name === 'state')
    return (
      header +
      `export const state = Object.freeze({ ...Object.fromEntries(${JSON.stringify(stateIds)}.map(id => [id, { get: () => getTestRuntime().state.fields[id].get(), set: (...args) => getTestRuntime().state.fields[id].set(...args), beginGesture: (...args) => getTestRuntime().state.fields[id].beginGesture(...args), endGesture: () => getTestRuntime().state.fields[id].endGesture(), subscribe: listener => getTestRuntime().state.fields[id].subscribe(listener) }])), onRestored: listener => getTestRuntime().state.onRestored(listener) });`
    );
  if (name === 'parameters')
    return (
      header +
      `export const parameters = Object.freeze(Object.fromEntries(${JSON.stringify(ids)}.map(id => [id, new Proxy({}, { get(_, key) { const parameter = getTestRuntime().parameters.byId[id]; const value = parameter[key]; return typeof value === 'function' ? (...args) => getTestRuntime().parameters.byId[id][key](...args) : value; } })])));`
    );
  if (name === 'host')
    return (
      header +
      `export let plugin, environment;\nsubscribeTestRuntime(runtime => { plugin = runtime.plugin; environment = runtime.environment; });\nexport const getHostState = () => getTestRuntime().snapshot();\nexport const subscribeHostState = listener => getTestRuntime().subscribe(listener);`
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
    const events =
      result.model.events.length > 0
        ? `\nexport const events = Object.freeze({ ${result.model.events.map((event) => `${JSON.stringify(event.name)}: Object.freeze({ subscribe: (listener) => getTestRuntime().subscribeNativeEvent(${JSON.stringify(event.name)}, listener) })`).join(', ')} });`
        : '';
    const channels =
      result.model.channels.length > 0
        ? `\nexport const channels = Object.freeze({ ${result.model.channels.map((channel) => `${JSON.stringify(channel.name)}: Object.freeze({ get: () => getTestRuntime().nativeChannelValue(${JSON.stringify(channel.name)}), subscribe: (listener) => getTestRuntime().subscribeNativeChannel(${JSON.stringify(channel.name)}, listener) })`).join(', ')} });`
        : '';
    return (
      header +
      result.model.methods
        .map(
          (method) =>
            `export ${method.async ? 'async ' : ''}function ${method.name}(...args) { return getTestRuntime().callNative(${JSON.stringify(method.name)}, args); }`,
        )
        .join('\n') +
      events +
      channels
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
