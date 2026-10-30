import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { runtimeTypeFiles } from './runtime-types';

const environment = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../environment',
);

describe('@soundor/environment', () => {
  it('holds the current runtime declarations (pnpm gen:runtime-types)', () => {
    for (const file of runtimeTypeFiles()) {
      expect(readFileSync(join(environment, file.path), 'utf8')).toBe(
        file.contents,
      );
    }
  });
});
