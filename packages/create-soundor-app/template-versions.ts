/**
 * The versions a new project's package.json gets, recorded when this package
 * is built (tsdown and vitest `define` them as `__TEMPLATE_VERSIONS__`):
 *
 * - `workspace:*` dependencies: the exact version of that Soundor package in
 *   this workspace, which the release publishes along with this one. Before
 *   1.0 a minor release can break a project, so new projects pin exactly.
 * - `catalog:` dependencies: the range in the workspace catalog, which the
 *   Soundor packages themselves are built and tested with.
 *
 * Read with Node at build time only; never part of the published code.
 */

import { readFileSync } from 'node:fs';

import { parse } from 'yaml';

const TEMPLATE = new URL('./templates/base/package.json', import.meta.url);
const WORKSPACE = new URL('../../pnpm-workspace.yaml', import.meta.url);

type Manifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export function templateVersions(): Record<string, string> {
  const template = readJson(TEMPLATE) as Manifest;
  const catalog = (
    parse(readFileSync(WORKSPACE, 'utf-8')) as {
      catalog?: Record<string, string>;
    }
  ).catalog;
  const versions: Record<string, string> = {};
  for (const [name, specifier] of Object.entries({
    ...template.dependencies,
    ...template.devDependencies,
  })) {
    if (specifier === 'workspace:*') {
      // A devDependency of this package, so the workspace links it here.
      versions[name] = (
        readJson(
          new URL(`./node_modules/${name}/package.json`, import.meta.url),
        ) as { version: string }
      ).version;
    } else if (specifier === 'catalog:') {
      const range = catalog?.[name];
      if (range === undefined) {
        throw new Error(`The template's ${name} is not in the catalog`);
      }
      versions[name] = range;
    }
  }
  return versions;
}

function readJson(url: URL): unknown {
  return JSON.parse(readFileSync(url, 'utf-8'));
}
