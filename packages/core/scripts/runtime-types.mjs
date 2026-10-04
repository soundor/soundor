/**
 * Writes runtime/globals.d.ts and runtime/ui.d.ts: the declarations of what
 * Soundor's runtime provides that are the same for every project, for
 * packages written against it (@soundor/react). Projects get the same
 * declarations generated into .soundor/generated.
 *
 *   pnpm --filter @soundor/core build && pnpm --filter @soundor/core gen:runtime-types
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runtimeTypeFiles } from '../dist/index.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const file of runtimeTypeFiles()) {
  writeFileSync(join(root, 'runtime', file.path), file.contents);
}
