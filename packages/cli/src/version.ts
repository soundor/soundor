import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The CLI's version, from the nearest `soundor` package.json above this file. */
export function cliVersion(): string | undefined {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(dir, 'package.json'), 'utf8'),
      ) as { name?: string; version?: string };
      if (pkg.name === 'soundor') return pkg.version;
    } catch {
      // No package.json here; keep looking.
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
