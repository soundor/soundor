/**
 * The examples' static web builds, copied into the site's `public/examples/`,
 * where `<Example name>` embeds them, each with `playground.json`: its UI
 * source files (`src/`, without tests), which the editor opens. The examples are the site's
 * devDependencies that live in `examples/`, so Turborepo runs their
 * `build:web` (never their full `build`, which would build the native plugin)
 * before the site's build.
 */

import {
  cpSync,
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { globSync } from 'node:fs';
import { join, sep } from 'node:path';

/** An example's editable code, as `playground.json` has it. */
export interface ExampleSources {
  /** The file the UI starts from. */
  readonly entry: string;
  /** Its UI source files, by path from the example's root. */
  readonly files: Readonly<Record<string, string>>;
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
    synced.push(name);
  }
  return synced;
}
