/**
 * The Vite plugin that connects a Web host project to Soundor. The lifecycle
 * (`soundor dev` / `soundor build`) adds it to every Vite run, whatever the
 * project's own `vite.config.ts` says, and it owns what must not drift:
 *
 * - the project root, the output directory and a relative production base,
 *   so the build can be hosted under any path;
 * - `@soundor/web-runtime/client` and the runtime's internal modules,
 *   resolved to this package's browser code so one page has one host. (Vite's
 *   dependency pre-bundling would otherwise load a second copy.)
 */

import { join } from 'node:path';

import type { Plugin } from 'vite';

import { MANIFEST_FILE } from './codegen';
import { clientModule } from './paths';

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
}

export function soundorWebPlugin(options: SoundorWebPluginOptions): Plugin {
  const client = (name: string) => clientModule(name, options.clientDir);
  return {
    name: PLUGIN_NAME,
    enforce: 'pre',
    config(config, env) {
      config.root = options.hostDir;
      config.clearScreen = false;
      config.optimizeDeps = {
        ...config.optimizeDeps,
        exclude: [...(config.optimizeDeps?.exclude ?? []), CLIENT_ID],
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
    resolveId(id) {
      if (id === CLIENT_ID) return client('index');
      if (id === 'soundor:internal/manifest') {
        return join(options.genDir, MANIFEST_FILE);
      }
      return null;
    },
  };
}
