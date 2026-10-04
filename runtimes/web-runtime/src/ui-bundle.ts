/**
 * The plugin UI in the Web host: the bundle the CLI built and keeps
 * rebuilding (`ctx.ui`). Vite serves and packages it but never rebundles the
 * project's UI sources, and watches nothing but the bundle's `build-id`.
 *
 * - **Assets.** The bundle names images by their stable asset ids; the page
 *   finds them at `soundor-assets/<id>` relative to itself, which the dev
 *   server serves from the bundle and the build emits.
 * - **Reload.** The CLI rewrites `build-id` last after every successful
 *   build. A new id reloads the page; anything else in the bundle directory
 *   (a build in progress, a failed one) leaves the page as it is.
 * - **Log.** In `soundor dev`, the page's console arrives over the dev
 *   server's connection and is appended to the CLI's UI log.
 */

import { readFileSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { UiBundleContext } from '@soundor/runtime-sdk';
import { normalizePath, type Plugin, type ViteDevServer } from 'vite';

import { ASSET_PATH, isAssetId, type UiLogEntry } from './client/protocol';

export interface SoundorUiBundleOptions {
  /** The plugin UI bundle; undefined when the project has no UI. */
  readonly ui?: UiBundleContext;
  /** Names the plugin in the UI log of `soundor dev`. */
  readonly pluginName?: string;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

interface UiManifest {
  readonly assets: readonly { readonly id: string }[];
}

export function soundorUiBundle(options: SoundorUiBundleOptions): Plugin {
  const { ui } = options;
  const uiDir = ui === undefined ? undefined : normalizePath(ui.dir);
  const inBundle = (file: string): boolean =>
    uiDir !== undefined && normalizePath(file).startsWith(`${uiDir}/`);
  let command: 'build' | 'serve' = 'serve';

  return {
    name: 'soundor:web-ui',
    configResolved(config) {
      command = config.command;
    },
    async buildStart() {
      if (ui === undefined || command !== 'build') return;
      const manifest = JSON.parse(
        await readFile(join(ui.dir, 'manifest.json'), 'utf8'),
      ) as UiManifest;
      for (const { id } of manifest.assets) {
        if (!isAssetId(id)) this.error(`Invalid UI asset id '${id}'`);
        this.emitFile({
          type: 'asset',
          fileName: `${ASSET_PATH}/${id}`,
          source: await readFile(join(ui.dir, 'assets', id)),
        });
      }
    },
    configureServer(server) {
      if (ui === undefined) return;
      serveAssets(server, ui);
      reloadOnBuild(server, ui);
      if (ui.live !== undefined) {
        appendLog(server, ui.live.logFile, options.pluginName ?? 'plugin');
      }
    },
    // The bundle changes while the CLI writes it; the page reloads on
    // build-id instead (above), so Vite's own update is dropped.
    hotUpdate({ file }) {
      if (inBundle(file)) return [];
      return undefined;
    },
  };
}

function serveAssets(server: ViteDevServer, ui: UiBundleContext): void {
  server.middlewares.use(`/${ASSET_PATH}`, (req, res, next) => {
    const id = (req.url ?? '').replace(/^\//, '').split('?')[0]!;
    if (!isAssetId(id)) {
      next();
      return;
    }
    readFile(join(ui.dir, 'assets', id)).then(
      (bytes) => {
        res.setHeader('Content-Type', CONTENT_TYPES[id.split('.').pop()!]!);
        res.setHeader('Cache-Control', 'no-cache');
        res.end(bytes);
      },
      () => next(),
    );
  });
}

function reloadOnBuild(server: ViteDevServer, ui: UiBundleContext): void {
  const file = normalizePath(join(ui.dir, 'build-id'));
  const read = (): string | undefined => {
    try {
      return readFileSync(file, 'utf8').trim();
    } catch {
      return undefined;
    }
  };
  let current = read();
  const onChange = (changed: string): void => {
    if (normalizePath(changed) !== file) return;
    const next = read();
    if (next === undefined || next === current) return;
    current = next;
    server.config.logger.info('The plugin UI was rebuilt; reloading the page.');
    server.ws.send({ type: 'full-reload', path: '*' });
  };
  server.watcher.add(file);
  server.watcher.on('add', onChange);
  server.watcher.on('change', onChange);
}

function appendLog(
  server: ViteDevServer,
  logFile: string,
  source: string,
): void {
  server.ws.on('soundor:log', (data: unknown) => {
    const entry = data as Partial<UiLogEntry> | null;
    if (
      entry === null ||
      typeof entry !== 'object' ||
      !['debug', 'info', 'warn', 'error'].includes(entry.level ?? '') ||
      typeof entry.message !== 'string'
    ) {
      return;
    }
    const line = JSON.stringify({
      level: entry.level,
      source,
      message: entry.message,
    });
    void appendFile(logFile, `${line}\n`).catch((error: unknown) => {
      server.config.logger.warn(
        `Could not write the UI log: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  });
}
