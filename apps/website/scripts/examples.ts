/**
 * The examples' static web builds, copied into the site's `public/examples/`,
 * where `<Example name>` embeds them. The examples are the site's
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
} from 'node:fs';
import { join, sep } from 'node:path';

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
    synced.push(name);
  }
  return synced;
}
