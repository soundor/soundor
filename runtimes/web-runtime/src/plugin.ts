/**
 * The Vite plugin that connects a Web host project to Soundor. The lifecycle
 * (`soundor dev` / `soundor build`) adds it to every Vite run, whatever the
 * project's own `vite.config.ts` says, and it owns what must not drift:
 *
 * - the project root, the output directory and a relative production base,
 *   so the build can be hosted under any path;
 * - `soundor:*`, `@soundor/web-runtime/client` and the runtime's internal
 *   modules, resolved to this package's browser code so one page has one
 *   host. (Vite's dependency pre-bundling would otherwise load a second
 *   copy.)
 * - the plugin UI: the bundle the CLI built (`ctx.ui`), loaded as it is and
 *   never rebundled from the project's sources (see `ui-bundle.ts`).
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { UiBundleContext } from '@soundor/runtime-sdk';
import { normalizePath, searchForWorkspaceRoot, type Plugin } from 'vite';

import type { WebManifest } from './client/manifest';
import { MANIFEST_FILE } from './codegen';
import { CLIENT_DIR, clientModule } from './paths';
import { soundorUiBundle } from './ui-bundle';

/** The plugin's name; `defineWebConfig` checks that it is present. */
export const PLUGIN_NAME = 'soundor:web';

const CLIENT_ID = '@soundor/web-runtime/client';

export interface SoundorWebPluginOptions {
  /** The Web host project: `runtimes/<id>/`. */
  readonly hostDir: string;
  /** The runtime's generated directory, holding the manifest. */
  readonly genDir: string;
  /** Production output directory (`build` only). */
  readonly outDir: string;
  /** This package's browser code (defaults to the installed one). */
  readonly clientDir?: string;
  /** The plugin UI bundle; undefined when the project has no UI. */
  readonly ui?: UiBundleContext;
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
        config.optimizeDeps = {
          ...config.optimizeDeps,
          exclude: [...(config.optimizeDeps?.exclude ?? []), CLIENT_ID],
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
    soundorModules(options),
    soundorUiBundle(options),
  ];
}

/** The runtime's modules, by specifier: what plugin code imports. */
const MODULES: Readonly<Record<string, string>> = {
  'soundor:parameters': 'modules/parameters',
  'soundor:host': 'modules/host',
  'soundor:ui': 'modules/ui',
  'soundor:storage': 'modules/storage',
  'soundor:fs': 'modules/fs',
};

export interface SoundorModulesOptions {
  /** The runtime's generated directory, holding the manifest. */
  readonly genDir: string;
  /** This package's browser code (defaults to the installed one). */
  readonly clientDir?: string;
  /** The plugin UI bundle; undefined when the project has no UI. */
  readonly ui?: UiBundleContext;
}

/** Internal modules whose code depends on the run (`\0`: virtual). */
const UI_MODULE = 'soundor:internal/ui';
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
  return {
    name: 'soundor:web-modules',
    enforce: 'pre',
    configResolved(config) {
      command = config.command;
    },
    resolveId(id) {
      if (id === CLIENT_ID) return client('index');
      if (!id.startsWith('soundor:')) return null;
      if (id === 'soundor:internal/manifest') {
        return join(options.genDir, MANIFEST_FILE);
      }
      if (id === UI_MODULE || id === DEV_MODULE || id === NATIVE_MODULE)
        return `\0${id}`;
      const module = MODULES[id];
      if (module === undefined) {
        this.error(`Unknown Soundor module '${id}'`);
      }
      return client(module);
    },
    async load(id) {
      if (id === `\0${UI_MODULE}`) return uiModule(options.ui);
      if (id === `\0${DEV_MODULE}`) return devModule(options.ui, command);
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
 * project's implementation directly.
 */
function nativeModule(manifest: WebManifest, bridge: string): string {
  const methods = manifest.native.methods.map(
    (method) =>
      `export const ${method.name} = nativeMethod(${JSON.stringify(method)});\n`,
  );
  return `import { nativeMethod } from ${JSON.stringify(bridge)};\n${methods.join('')}`;
}

/** How the host loads the plugin UI: the CLI's bundle, imported as it is. */
function uiModule(ui: UiBundleContext | undefined): string {
  if (ui === undefined) {
    return 'export const hasUi = false;\nexport function loadUi() {\n  return Promise.resolve();\n}\n';
  }
  const bundle = JSON.stringify(normalizePath(join(ui.dir, ui.entry)));
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
