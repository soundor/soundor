import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

/**
 * Every plugin bundle keeps the soundor:* imports of @soundor/react, however
 * little of it the plugin uses, so a module imported here must exist in every
 * host that runs a bundle. These are the ones the engine always provides
 * (soundor_run_ui, which installs History, runs bundles with nothing more).
 * A module a plugin may or may not have, such as soundor:presets, is taken by
 * the hook as an argument instead.
 */
const ALWAYS_PROVIDED = ['soundor:history', 'soundor:host', 'soundor:ui'];

it("imports only the soundor:* modules every host provides, so a plugin that does not use a hook's module still runs", () => {
  const dist = dirname(fileURLToPath(import.meta.resolve('@soundor/react')));
  const imported = new Set<string>();
  for (const file of readdirSync(dist)) {
    if (!file.endsWith('.js')) continue;
    const source = readFileSync(join(dist, file), 'utf8');
    for (const match of source.matchAll(/['"](soundor:[a-z-]+)['"]/g))
      imported.add(match[1]!);
  }
  expect([...imported].sort()).toEqual(ALWAYS_PROVIDED);
});
