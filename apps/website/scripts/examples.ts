/**
 * The examples' static web builds, copied into the site's `public/examples/`,
 * where `<Example name>` embeds them, each with `playground.json`: its UI
 * source files (`src/`, without tests), which the editor opens, and
 * `types.json`: the types they are checked against, which the editor's
 * language service reads (`types.ts`). An example with snippets
 * (`src/snippets/<name>.tsx`, as `examples/snippets` has) also gets
 * `snippets/<name>.json` for each: the snippet, rendered alone in its
 * `src/frame.tsx`. The examples are the site's
 * devDependencies that live in `examples/`, so Turborepo runs their
 * `build:web` (never their full `build`, which would build the native plugin)
 * before the site's build.
 */

import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { globSync } from 'node:fs';
import { extname, join, posix, sep } from 'node:path';

import { exampleTypes } from './types.ts';

/** An example's editable code, as `playground.json` has it. */
export interface ExampleSources {
  /** The file the UI starts from. */
  readonly entry: string;
  /** Its UI source files, by path from the example's root. */
  readonly files: Readonly<Record<string, string>>;
  /** The files the editor shows; every one when absent. */
  readonly editable?: readonly string[];
  /** The images the files import: asset ids by path (`src/assets/cover.png`). */
  readonly assets?: Readonly<Record<string, string>>;
}

/** Image imports, as a snippet may have them: `import cover from '../assets/cover.png'`. */
const IMAGE_IMPORT = /from '(\.{1,2}\/[^']+\.(?:png|jpe?g|webp))'/gi;

/**
 * An image's asset id, as the CLI's bundler names it (`assetId` in
 * `packages/cli/src/ui/bundle.ts`): the web build serves the image at
 * `soundor-assets/<id>`, which `syncExamples` checks.
 */
export function assetId(bytes: Uint8Array, path: string): string {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  return `${hash}${extname(path).toLowerCase()}`;
}

/** Where an example keeps its snippets, one component per file. */
const SNIPPETS = 'src/snippets';
/** The entry a snippet runs from: written here, never in the example. */
const SNIPPET_ENTRY = 'src/snippet.tsx';

/** The snippets in the example in `dir`, by name: their files' names. */
export function snippetFiles(dir: string): Record<string, string> {
  const snippets: Record<string, string> = {};
  if (!existsSync(join(dir, SNIPPETS))) return snippets;
  for (const file of globSync('*.tsx', { cwd: join(dir, SNIPPETS) }).sort()) {
    snippets[file.replace(/\.tsx$/, '')] = `${SNIPPETS}/${file}`;
  }
  return snippets;
}

/**
 * The code that runs the snippet `name` of the example in `dir`: the
 * snippet's default export, alone in the example's `Frame`. Only the
 * snippet is editable.
 */
export function snippetSources(dir: string, name: string): ExampleSources {
  const file = snippetFiles(dir)[name];
  if (file === undefined) throw new Error(`${dir} has no snippet ${name}`);
  const frame = 'src/frame.tsx';
  if (!existsSync(join(dir, frame))) {
    throw new Error(`${dir} has snippets, but no ${frame} to show them in`);
  }
  const entry = [
    "import { render } from '@soundor/react';",
    '',
    "import { Frame } from './frame';",
    `import Snippet from './snippets/${name}';`,
    '',
    'render(',
    '  <Frame>',
    '    <Snippet />',
    '  </Frame>,',
    ');',
    '',
  ].join('\n');
  const code = readFileSync(join(dir, file), 'utf-8');
  const assets: Record<string, string> = {};
  for (const [, specifier] of code.matchAll(IMAGE_IMPORT)) {
    const path = posix.join(posix.dirname(file), specifier!);
    assets[path] = assetId(readFileSync(join(dir, path)), path);
  }
  return {
    entry: SNIPPET_ENTRY,
    files: {
      [SNIPPET_ENTRY]: entry,
      [frame]: readFileSync(join(dir, frame), 'utf-8'),
      [file]: code,
    },
    editable: [file],
    ...(Object.keys(assets).length > 0 && { assets }),
  };
}

const ENTRIES = ['src/main.tsx', 'src/main.ts'];

/** The UI source files of the example in `dir`: `src/`, without tests. */
export function exampleSources(dir: string): ExampleSources {
  const files: Record<string, string> = {};
  for (const file of globSync('src/**/*.{ts,tsx}', { cwd: dir }).sort()) {
    if (/\.test\.tsx?$/.test(file)) continue;
    files[file.split(sep).join('/')] = readFileSync(join(dir, file), 'utf-8');
  }
  const entry = ENTRIES.find((candidate) => candidate in files);
  if (entry === undefined) {
    throw new Error(`${dir} has no ${ENTRIES.join(' or ')}`);
  }
  return { entry, files };
}

/** Copies every example's web build into `site`; returns their names. */
export function syncExamples(site: string): string[] {
  const manifest = JSON.parse(
    readFileSync(join(site, 'package.json'), 'utf-8'),
  ) as { devDependencies?: Record<string, string> };
  const out = join(site, 'public/examples');
  rmSync(out, { recursive: true, force: true });

  const synced: string[] = [];
  for (const name of Object.keys(manifest.devDependencies ?? {})) {
    const dir = realpathSync(join(site, 'node_modules', name));
    if (!dir.includes(`${sep}examples${sep}`)) continue;
    const build = join(dir, '.soundor/dist/web');
    if (!existsSync(join(build, 'index.html'))) {
      throw new Error(
        `${name} has no web build in ${build}: run \`pnpm turbo run build --filter=website\`, which builds it first`,
      );
    }
    cpSync(build, join(out, name), { recursive: true });
    writeFileSync(
      join(out, name, 'playground.json'),
      JSON.stringify(exampleSources(dir)),
    );
    writeFileSync(
      join(out, name, 'types.json'),
      JSON.stringify(exampleTypes(dir)),
    );
    const snippets = Object.keys(snippetFiles(dir));
    if (snippets.length > 0) mkdirSync(join(out, name, 'snippets'));
    for (const snippet of snippets) {
      const sources = snippetSources(dir, snippet);
      for (const [path, id] of Object.entries(sources.assets ?? {})) {
        if (!existsSync(join(out, name, 'soundor-assets', id))) {
          throw new Error(
            `${name}'s web build has no ${path} (soundor-assets/${id}): import it in the example's UI, so the build serves it`,
          );
        }
      }
      writeFileSync(
        join(out, name, 'snippets', `${snippet}.json`),
        JSON.stringify(sources),
      );
    }
    synced.push(name);
  }
  return synced;
}
