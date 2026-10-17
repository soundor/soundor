/**
 * Copies each example's static web build into `public/examples/<name>/`, where
 * `<Example name>` embeds it. The examples are this package's devDependencies
 * from `examples/`, so Turborepo runs their `build:web` (never their full
 * `build`, which would build the native plugin) before this.
 */

import {
  cpSync,
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';

const here = new URL('..', import.meta.url).pathname;
const manifest = JSON.parse(
  readFileSync(join(here, 'package.json'), 'utf-8'),
) as {
  devDependencies: Record<string, string>;
};

const out = join(here, 'public/examples');
rmSync(out, { recursive: true, force: true });

const synced: string[] = [];
for (const name of Object.keys(manifest.devDependencies)) {
  const dir = realpathSync(join(here, 'node_modules', name));
  if (!dir.includes('/examples/')) continue;
  const build = join(dir, '.soundor/dist/web');
  if (!existsSync(join(build, 'index.html'))) {
    throw new Error(
      `${name} has no web build in ${build}: run \`pnpm turbo run build --filter=website\`, which builds it first`,
    );
  }
  cpSync(build, join(out, name), { recursive: true });
  synced.push(name);
}
console.log(`Examples: ${synced.join(', ')}`);
