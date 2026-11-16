/**
 * The private Vite integration for the package-owned host. The lifecycle
 * (`soundor dev` / `soundor build`) supplies the plugin project's paths and
 * owns what must not drift:
 *
 * - the project root, the output directory and a relative production base,
 *   so the build can be hosted under any path;
 * - `soundor:*`, `@soundor/web-runtime/client` and the runtime's internal
 *   modules, resolved to this package's browser code so one page has one
 *   host. (Vite's dependency pre-bundling would otherwise load a second
 *   copy.)
 * - the plugin UI: the bundle the CLI built (`ctx.ui`), loaded as it is and
 *   never rebundled from the project's sources (see `ui-bundle.ts`);
 * - the engine's WebAssembly (`soundor-core.wasm`, which soundor:ui lays out
 *   with), served by the dev server and emitted as an asset of a build.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  renderEnvironmentModule,
  type EnvironmentMode,
  type UiBundleContext,
} from '@soundor/runtime-sdk';
import { normalizePath, searchForWorkspaceRoot, type Plugin } from 'vite';

import type { WebManifest } from './client/manifest.ts';
import { MANIFEST_FILE, PARAMETERS_FILE } from './codegen.ts';
import { engineWasmPath } from './engine-wasm.ts';
import { defaultInputs } from './input-options.ts';
import type { WebOptions } from './options.ts';
import { CLIENT_DIR, clientModule } from './paths.ts';
import { soundorUiBundle } from './ui-bundle.ts';

/** The managed integration's plugin name. */
export const PLUGIN_NAME = 'soundor:web';

const PACKAGE = '@soundor/web-runtime';
const CLIENT_ID = `${PACKAGE}/client`;
/** What the client imports from npm: the engine, and the host UI's Preact. */
const CLIENT_DEPENDENCIES = [
  '@soundor/engine/web',
  'preact',
  'preact/hooks',
  'preact/jsx-runtime',
];

export interface SoundorWebPluginOptions {
  /** This package's host HTML directory. */
  readonly hostDir: string;
  /** Plugin root, independent of the package-owned host. */
  readonly projectRoot?: string;
  readonly inputs?: WebOptions['inputs'];
  /** The runtime's generated directory, holding the manifest. */
  readonly genDir: string;
  /** Lifecycle-selected mode; a debug build uses development values. */
  readonly environmentMode?: EnvironmentMode;
  /** Production output directory (`build` only). */
  readonly outDir: string;
  /** This package's browser code (defaults to the installed one). */
  readonly clientDir?: string;
  /** The plugin UI bundle; undefined when the project has no UI. */
  readonly ui?: UiBundleContext;
  /** The audio processor's WebAssembly module (native/, built by Cargo). */
  readonly processor?: string;
  /** Names the plugin in the UI log of `soundor dev`. */
  readonly pluginName?: string;
}

export function soundorWebPlugin(options: SoundorWebPluginOptions): Plugin[] {
  return [
    {
      name: PLUGIN_NAME,
      enforce: 'pre',
      config(config, env) {
        config.root = options.hostDir;
        config.clearScreen = false;
        // The client imports soundor:* and is served as is. Its own
        // dependencies are optimized up front, through this package (the
        // project need not depend on them): found late, they would be
        // optimized again mid-session and load twice.
        config.optimizeDeps = {
          ...config.optimizeDeps,
          include: [
            ...(config.optimizeDeps?.include ?? []),
            ...CLIENT_DEPENDENCIES.map((id) => `${PACKAGE} > ${id}`),
          ],
          exclude: [
            ...(config.optimizeDeps?.exclude ?? []),
            CLIENT_ID,
            `${PACKAGE}/input`,
          ],
        };
        // Vite serves files outside the host project only from allowed
        // directories: the generated manifest, the UI bundle, this package.
        config.server = {
          ...config.server,
          fs: {
            ...config.server?.fs,
            allow: [
              ...(config.server?.fs?.allow ?? [
                searchForWorkspaceRoot(options.hostDir),
              ]),
              options.projectRoot ?? options.hostDir,
              options.genDir,
              options.clientDir ?? CLIENT_DIR,
              ...(options.ui === undefined ? [] : [options.ui.dir]),
            ],
          },
        };
        if (env.command === 'build') {
          // Relative URLs: the static build works below any path, in an iframe.
          config.base = './';
          config.build = {
            ...config.build,
            outDir: options.outDir,
            emptyOutDir: true,
          };
        }
      },
    },
    {
      name: 'soundor:managed-host',
      transformIndexHtml(html) {
        const title = (options.pluginName ?? 'Soundor')
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;');
        return html.replace(
          '<title>Soundor</title>',
          `<title>${title}</title>`,
        );
      },
    },
    soundorModules(options),
    soundorUiBundle(options),
  ];
}

/** The runtime's modules, by specifier: what plugin code imports. */
const MODULES: Readonly<Record<string, string>> = {
  'soundor:state': 'modules/state',
  'soundor:history': 'modules/history',
  'soundor:presets': 'modules/presets',
  'soundor:parameters': 'modules/parameters',
  'soundor:host': 'modules/host',
  'soundor:ui': 'modules/ui',
  'soundor:storage': 'modules/storage',
  'soundor:fs': 'modules/fs',
};

export interface SoundorModulesOptions {
  readonly projectRoot?: string;
  readonly inputs?: WebOptions['inputs'];
  /** The runtime's generated directory, holding the manifest. */
  readonly genDir: string;
  /** Lifecycle-selected mode; a debug build uses development values. */
  readonly environmentMode?: EnvironmentMode;
  /** This package's browser code (defaults to the installed one). */
  readonly clientDir?: string;
  /** The plugin UI bundle; undefined when the project has no UI. */
  readonly ui?: UiBundleContext;
  /** The audio processor's WebAssembly module; none, and the input passes through. */
  readonly processor?: string;
  /**
   * The engine's WebAssembly; by default the one `engineWasmPath()` finds.
   * `inline` reads it from the file where the page runs in Node (tests)
   * instead of serving it.
   */
  readonly engine?: { readonly wasm?: string; readonly inline?: boolean };
}

/** The engine's module: where the page loads its WebAssembly from. */
export const ENGINE_MODULE = 'soundor:internal/engine';
/** Where the dev server serves the engine's WebAssembly. */
const ENGINE_URL = '@soundor/engine/soundor-core.wasm';

/** Internal modules whose code depends on the run (`\0`: virtual). */
const UI_MODULE = 'soundor:internal/ui';
/** The audio processor's module, inlined: no file to serve or find. */
export const PROCESSOR_MODULE = 'soundor:internal/processor';
const DEV_MODULE = 'soundor:internal/dev';
/** Its exports are the project's native methods, read from the manifest. */
const NATIVE_MODULE = 'soundor:native';

/**
 * Resolves `soundor:*` (and the host's client entry) to this package's
 * browser code: the Web implementation of Soundor's runtime modules, all
 * sharing the page's one host context.
 */
export function soundorModules(options: SoundorModulesOptions): Plugin {
  const client = (name: string) => clientModule(name, options.clientDir);
  let command: 'build' | 'serve' = 'serve';
  let base = '/';
  let environmentMode: EnvironmentMode =
    options.environmentMode ?? 'development';
  // Prepared once per plugin (a download or build at most), when the page
  // first needs it; a failure is tried again on the next request.
  let prepared: Promise<string> | undefined;
  const enginePath = (): Promise<string> => {
    if (options.engine?.wasm !== undefined)
      return Promise.resolve(options.engine.wasm);
    if (prepared === undefined) {
      prepared = engineWasmPath();
      prepared.catch(() => {
        prepared = undefined;
      });
    }
    return prepared;
  };
  return {
    name: 'soundor:web-modules',
    enforce: 'pre',
    configureServer(server) {
      // The engine's module, as WebAssembly (compiled while it downloads),
      // cached as long as its content hash, in the URL, is the same.
      server.middlewares.use((request, response, next) => {
        const url = request.url?.split('?')[0];
        if (url !== `${base}${ENGINE_URL}`) return next();
        enginePath()
          .then((path) => readFile(path))
          .then(
            (bytes) => {
              response.setHeader('content-type', 'application/wasm');
              response.setHeader(
                'cache-control',
                'public, max-age=31536000, immutable',
              );
              response.end(bytes);
            },
            (error: unknown) => next(error),
          );
      });
    },
    configResolved(config) {
      command = config.command;
      base = config.base.endsWith('/') ? config.base : `${config.base}/`;
      environmentMode =
        options.environmentMode ??
        (command === 'build' ? 'production' : 'development');
    },
    resolveId(id) {
      if (id === '/@soundor/host.js') return client('managed');
      if (id === `${PACKAGE}/input`) return client('input');
      if (id === CLIENT_ID) return client('index');
      if (id === 'soundor:internal/inputs') {
        if (typeof options.inputs === 'string')
          return resolve(options.projectRoot!, options.inputs);
        return `\0${id}`;
      }
      if (!id.startsWith('soundor:')) return null;
      if (id === 'soundor:internal/manifest') {
        return join(options.genDir, MANIFEST_FILE);
      }
      if (id === 'soundor:internal/parameters') {
        return join(options.genDir, PARAMETERS_FILE);
      }
      if (
        id === UI_MODULE ||
        id === DEV_MODULE ||
        id === ENGINE_MODULE ||
        id === PROCESSOR_MODULE ||
        id === NATIVE_MODULE ||
        id === 'soundor:env'
      )
        return `\0${id}`;
      const module = MODULES[id];
      if (module === undefined) {
        this.error(`Unknown Soundor module '${id}'`);
      }
      return client(module);
    },
    async load(id) {
      if (id === '\0soundor:internal/inputs')
        return `export default ${JSON.stringify(options.inputs ?? defaultInputs)};\n`;
      if (id === `\0${UI_MODULE}`) return uiModule(options.ui);
      if (id === `\0${DEV_MODULE}`) return devModule(options.ui, command);
      if (id === `\0${ENGINE_MODULE}`) {
        let path: string;
        try {
          path = await enginePath();
        } catch (error) {
          this.error((error as Error).message);
        }
        this.addWatchFile(path);
        if (options.engine?.inline === true)
          return `import { readFileSync } from 'node:fs';\nexport default { wasm: readFileSync(${JSON.stringify(path)}) };\n`;
        const bytes = await readFile(path);
        if (command === 'build') {
          const reference = this.emitFile({
            type: 'asset',
            name: 'soundor-core.wasm',
            source: bytes,
          });
          return `export default { wasmUrl: import.meta.ROLLUP_FILE_URL_${reference} };\n`;
        }
        const hash = createHash('sha256')
          .update(bytes)
          .digest('hex')
          .slice(0, 16);
        return `export default { wasmUrl: new URL(${JSON.stringify(`${base}${ENGINE_URL}?v=${hash}`)}, location.href).href };\n`;
      }
      if (id === `\0${PROCESSOR_MODULE}`) {
        if (options.processor === undefined)
          return 'export default undefined;\n';
        this.addWatchFile(options.processor);
        const bytes = await readFile(options.processor);
        return `export default ${JSON.stringify(bytes.toString('base64'))};\n`;
      }
      if (id === '\0soundor:env') {
        const path = join(options.genDir, MANIFEST_FILE);
        this.addWatchFile(path);
        const manifest = JSON.parse(
          await readFile(path, 'utf8'),
        ) as WebManifest;
        return renderEnvironmentModule(manifest.env, environmentMode);
      }
      if (id === `\0${NATIVE_MODULE}`) {
        const manifest = join(options.genDir, MANIFEST_FILE);
        this.addWatchFile(manifest);
        return nativeModule(
          JSON.parse(await readFile(manifest, 'utf8')) as WebManifest,
          normalizePath(client('native-bridge')),
        );
      }
      return null;
    },
  };
}

/**
 * `soundor:native`: one export per declared method, each calling the
 * project's implementation directly, and the declared `events` and `streams`.
 */
function nativeModule(manifest: WebManifest, bridge: string): string {
  const methods = manifest.native.methods.map(
    (method) =>
      `export const ${method.name} = nativeMethod(${JSON.stringify(method)});\n`,
  );
  const events =
    manifest.native.events.length > 0
      ? 'export const events = nativeEvents();\n'
      : '';
  const streams =
    manifest.native.streams.length > 0
      ? 'export const streams = nativeStreams();\n'
      : '';
  return `import { nativeEvents, nativeMethod, nativeStreams } from ${JSON.stringify(bridge)};\n${methods.join('')}${events}${streams}`;
}

/** How the host loads the plugin UI: the CLI's bundle, imported as it is. */
function uiModule(ui: UiBundleContext | undefined): string {
  if (ui === undefined) {
    return 'export const hasUi = false;\nexport function loadUi() {\n  return Promise.resolve();\n}\n';
  }
  const bundle = JSON.stringify(normalizePath(join(ui.dir, ui.module)));
  return `export const hasUi = true;\nexport function loadUi() {\n  return import(${bundle});\n}\n`;
}

/**
 * The run's presentation, and in `soundor dev` how the page sends its
 * console to the terminal: over Vite's dev server connection.
 */
function devModule(
  ui: UiBundleContext | undefined,
  command: 'build' | 'serve',
): string {
  // The dev server shows the inspector; a build is a clean demo.
  const presentation = `export const presentation = ${JSON.stringify(command === 'serve' ? 'dev' : 'demo')};\n`;
  if (ui?.live === undefined)
    return `${presentation}export const sendLog = undefined;\n`;
  return `${presentation}export const sendLog = import.meta.hot\n  ? (entry) => import.meta.hot.send('soundor:log', entry)\n  : undefined;\n`;
}
