/**
 * Writes @soundor/environment (packages/environment/*.d.ts): the
 * declarations of what Soundor's runtime provides that are the same for every
 * project, for libraries written against it (@soundor/react). Projects get
 * the same declarations generated into .soundor/generated.
 *
 *   pnpm --filter @soundor/core build && pnpm --filter @soundor/core gen:runtime-types
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runtimeTypeFiles } from '../dist/index.mjs';

const environment = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../environment',
);
for (const file of runtimeTypeFiles()) {
  writeFileSync(join(environment, file.path), file.contents);
}
