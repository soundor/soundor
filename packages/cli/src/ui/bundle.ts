/**
 * Builds a plugin's UI — TypeScript/TSX and the packages it imports — into a
 * single JavaScript bundle for Soundor's embedded runtime, with tsdown.
 *
 * Output (in `outDir`):
 * - `bundle.js` — one ES module; `soundor:*` imports stay imports (the runtime
 *   provides them), everything else is inlined. Minified in production.
 * - `bundle.js.map` — source map, in development.
 * - `assets/<id>` — every imported image, named by content hash.
 * - `manifest.json` — the bundle's assets, for tooling.
 *
 * The bundle never contains the bundler, TypeScript, or a dev server; it is
 * plain JavaScript for QuickJS.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

import { build, type TsdownPlugin } from 'tsdown';

export type UiBundleMode = 'development' | 'production';

export interface BundleUiOptions {
  /** Project root (where soundor.config.ts lives). */
  readonly root: string;
  readonly mode: UiBundleMode;
  readonly outDir: string;
  /** Entry module; defaults to the first of src/main.{tsx,ts,jsx,js}. */
  readonly entry?: string;
}

export interface UiAsset {
  /** Stable id: content hash + extension, e.g. `9f86d081884c7d65.png`. */
  readonly id: string;
  /** Source path, relative to the project root. */
  readonly source: string;
  readonly type: string;
  readonly size: number;
}

export interface UiBundle {
  readonly dir: string;
  /** The bundle file inside `dir`. */
  readonly entry: 'bundle.js';
  readonly assets: readonly UiAsset[];
}

const ENTRY_CANDIDATES = [
  'src/main.tsx',
  'src/main.ts',
  'src/main.jsx',
  'src/main.js',
];

/** Image formats a plugin can bundle (decoded natively at render time). */
export const ASSET_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/** The UI entry module of a project, or undefined if it has no UI. */
export function findUiEntry(root: string): string | undefined {
  for (const candidate of ENTRY_CANDIDATES) {
    const path = resolve(root, candidate);
    if (existsSync(path)) return path;
  }
  return undefined;
}

/**
 * The stable id of an asset's bytes. Identical files share one id, and an id
 * only changes when the content does.
 */
export function assetId(bytes: Uint8Array, path: string): string {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  return `${hash}${extname(path).toLowerCase()}`;
}

/** Turns image imports into asset ids and collects their bytes. */
function assetPlugin(
  root: string,
  assets: Map<string, { asset: UiAsset; bytes: Uint8Array }>,
): TsdownPlugin {
  return {
    name: 'soundor:assets',
    async load(id) {
      const path = id.split('?')[0]!;
      const type = ASSET_TYPES[extname(path).toLowerCase()];
      if (type === undefined) return null;
      const bytes = await readFile(path);
      const asset: UiAsset = {
        id: assetId(bytes, path),
        source: relative(root, path).split('\\').join('/'),
        type,
        size: bytes.length,
      };
      assets.set(asset.id, { asset, bytes });
      return {
        code: `export default ${JSON.stringify(asset.id)};`,
        moduleType: 'js',
      };
    },
  };
}

/** Bundles the project's UI, or returns undefined when it has none. */
export async function bundleUi(
  options: BundleUiOptions,
): Promise<UiBundle | undefined> {
  const entry = options.entry ?? findUiEntry(options.root);
  if (entry === undefined) return undefined;
  const production = options.mode === 'production';
  const outDir = resolve(options.outDir);
  const assets = new Map<string, { asset: UiAsset; bytes: Uint8Array }>();

  await rm(outDir, { recursive: true, force: true });
  await build({
    config: false,
    cwd: options.root,
    entry: { bundle: entry },
    outDir,
    format: 'esm',
    platform: 'neutral',
    target: 'es2023',
    // A plugin UI is one self-contained bundle: inline every package, keep
    // only the runtime's own modules external.
    deps: {
      alwaysBundle: [/.*/],
      neverBundle: [/^soundor:/],
      onlyBundle: false,
    },
    minify: production,
    sourcemap: !production,
    treeshake: true,
    dts: false,
    clean: false,
    hash: false,
    report: false,
    publint: false,
    logLevel: 'error',
    fixedExtension: false,
    outExtensions: () => ({ js: '.js' }),
    // Soundor has no `process`; libraries such as React read NODE_ENV.
    define: {
      'process.env.NODE_ENV': JSON.stringify(options.mode),
      'import.meta.env.MODE': JSON.stringify(options.mode),
      'import.meta.env.DEV': JSON.stringify(!production),
      'import.meta.env.PROD': JSON.stringify(production),
    },
    outputOptions: { codeSplitting: false },
    plugins: [assetPlugin(options.root, assets)],
  });

  const sorted = [...assets.values()].sort((a, b) =>
    a.asset.id.localeCompare(b.asset.id),
  );
  if (sorted.length > 0) {
    await mkdir(join(outDir, 'assets'), { recursive: true });
    for (const { asset, bytes } of sorted) {
      await writeFile(join(outDir, 'assets', asset.id), bytes);
    }
  }
  const manifest = {
    entry: 'bundle.js',
    mode: options.mode,
    assets: sorted.map(({ asset }) => asset),
  };
  await writeFile(
    join(outDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return { dir: outDir, entry: 'bundle.js', assets: manifest.assets };
}
