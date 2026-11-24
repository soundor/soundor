// Third-party notices of a package's own bundle: a published package whose
// dist inlines npm packages (the engine's lowering, with Babel; the DevTools
// dashboard, with React) ships their license texts beside it, in the layout
// plugin builds use (@soundor/core's notices.ts):
//
//   <directory>/THIRD-PARTY-NOTICES.txt     every package, then its texts
//   <directory>/licenses.json               the same, for tools
//   <directory>/javascript/<name>@<ver>/    its license files, as they are
//
// A rolldown plugin, for tsdown and Vite alike. Only what tree shaking kept
// counts, and only packages in node_modules: this repository's own packages
// are under its license, which every published package carries. A bundled
// package without a license file fails the build.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

interface RenderedChunk {
  readonly type: 'chunk';
  readonly modules: Readonly<
    Record<string, { readonly renderedLength: number }>
  >;
}

interface EmitContext {
  emitFile(file: {
    type: 'asset';
    fileName: string;
    source: string | Uint8Array;
  }): unknown;
  error(message: string): never;
}

/** The plugin {@link thirdPartyNotices} makes (tsdown's and Vite's shape). */
export interface NoticesPlugin {
  readonly name: string;
  generateBundle(
    this: EmitContext,
    options: unknown,
    bundle: Readonly<
      Record<string, RenderedChunk | { readonly type: 'asset' }>
    >,
  ): void;
}

const LICENSE_FILE =
  /^(?:licen[cs]e|copying|notice|third[-_ ]party[-_ ]notices?)(?:$|[-_.])/i;
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|json|map)$/i;

interface Bundled {
  readonly name: string;
  readonly version: string;
  readonly license?: string;
  readonly root: string;
  readonly files: readonly string[];
}

/** The package a module in node_modules belongs to: the folder below the last node_modules. */
function packageRoot(id: string): string | undefined {
  const parts = id.split('?')[0]!.split(sep);
  const last = parts.lastIndexOf('node_modules');
  if (last === -1 || last + 1 >= parts.length) return undefined;
  return parts
    .slice(0, last + (parts[last + 1]!.startsWith('@') ? 3 : 2))
    .join(sep);
}

function readPackage(root: string): Bundled | undefined {
  let manifest: { name?: unknown; version?: unknown; license?: unknown };
  try {
    manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch {
    return undefined;
  }
  if (typeof manifest.name !== 'string') return undefined;
  const files = readdirSync(root)
    .filter((name) => LICENSE_FILE.test(name) && !SOURCE_FILE.test(name))
    .filter((name) => statSync(join(root, name)).isFile())
    .sort();
  return {
    name: manifest.name,
    version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
    ...(typeof manifest.license === 'string'
      ? { license: manifest.license }
      : {}),
    root,
    files,
  };
}

/**
 * Emits the notices of the npm packages a bundle inlines into `directory`
 * of its output (default `licenses`), named in `title`'s heading.
 */
export function thirdPartyNotices(options: {
  readonly directory?: string;
  readonly title: string;
}): NoticesPlugin {
  const directory = options.directory ?? 'licenses';
  return {
    name: 'soundor:third-party-notices',
    generateBundle(_options, bundle) {
      const packages = new Map<string, Bundled>();
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const [id, module] of Object.entries(output.modules)) {
          if (module.renderedLength === 0 || id.startsWith('\0')) continue;
          const root = packageRoot(id);
          if (root === undefined) continue;
          const found = readPackage(root);
          if (found !== undefined)
            packages.set(`${found.name}@${found.version}`, found);
        }
      }
      const sorted = [...packages.values()].sort(
        (a, b) =>
          a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
      );
      const missing = sorted.filter((entry) => entry.files.length === 0);
      if (missing.length > 0)
        this.error(
          `Bundled packages without a license file to ship: ${missing
            .map(
              (entry) =>
                `${entry.name} ${entry.version} (${entry.license ?? 'no license declared'})`,
            )
            .join(', ')}`,
        );

      const folder = (entry: Bundled) =>
        `javascript/${entry.name}@${entry.version}`;
      const describe = (entry: Bundled) =>
        `${entry.name} ${entry.version}${entry.license === undefined ? '' : ` (${entry.license})`}`;
      const lines = [
        `Third-party notices: ${options.title}`,
        '',
        sorted.length === 0
          ? 'It bundles no third-party packages.'
          : 'It bundles the packages listed below. The license texts of each one follow,\nand are also in the folder of licenses/ named after it.',
        '',
        ...sorted.map((entry) => `  ${folder(entry)}  ${describe(entry)}`),
        '',
      ];
      for (const entry of sorted) {
        lines.push(
          '='.repeat(78),
          `${describe(entry)}  [${folder(entry)}]`,
          '='.repeat(78),
          '',
        );
        for (const file of entry.files) {
          const text = readFileSync(join(entry.root, file), 'utf8');
          this.emitFile({
            type: 'asset',
            fileName: `${directory}/${folder(entry)}/${file}`,
            source: text,
          });
          if (entry.files.length > 1)
            lines.push(`--- ${folder(entry)}/${file}`, '');
          lines.push(text.trimEnd(), '');
        }
      }
      this.emitFile({
        type: 'asset',
        fileName: `${directory}/THIRD-PARTY-NOTICES.txt`,
        source: `${lines.join('\n').trimEnd()}\n`,
      });
      this.emitFile({
        type: 'asset',
        fileName: `${directory}/licenses.json`,
        source: `${JSON.stringify(
          {
            format: 1,
            components: sorted.map((entry) => ({
              section: 'javascript',
              name: entry.name,
              version: entry.version,
              ...(entry.license === undefined
                ? {}
                : { license: entry.license }),
              origin: 'found',
              directory: folder(entry),
              files: entry.files.map((file) => `${folder(entry)}/${file}`),
            })),
          },
          null,
          2,
        )}\n`,
      });
    },
  };
}
