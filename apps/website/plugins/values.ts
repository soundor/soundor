/**
 * Reads the docs' placeholder values (see `src/lib/placeholders.ts`) from the
 * repository, in Node, when the site is built.
 */

import { readdirSync, readFileSync } from 'node:fs';

import type { SiteValues } from '../src/lib/placeholders.ts';

const ROOT = new URL('../../../', import.meta.url);
const PACKAGE_DIRS = ['packages', 'runtimes', 'configs'];

type Manifest = {
  name: string;
  version: string;
  private?: boolean;
  engines?: Record<string, string>;
};

function manifests(): Manifest[] {
  const found: Manifest[] = [];
  for (const dir of PACKAGE_DIRS) {
    for (const entry of readdirSync(new URL(`${dir}/`, ROOT), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      try {
        found.push(
          JSON.parse(
            readFileSync(
              new URL(`${dir}/${entry.name}/package.json`, ROOT),
              'utf-8',
            ),
          ) as Manifest,
        );
      } catch {
        // Not a package.
      }
    }
  }
  return found;
}

export function siteValues(): SiteValues {
  const all = manifests();
  const versions = Object.fromEntries(all.map((m) => [m.name, m.version]));
  const node = all.find((m) => m.name === 'soundor')?.engines?.['node'];
  if (node === undefined) throw new Error('soundor has no engines.node');
  return { versions, node };
}
