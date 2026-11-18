import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

import { renderExpressionCorpus } from '../tests/expression-corpus';

const golden = fileURLToPath(new URL('../native/tests/generated/expression-corpus.json', import.meta.url));

it("is @soundor/expression's corpus with its JavaScript results (UPDATE_GOLDEN=1 writes it)", () => {
  const expected = renderExpressionCorpus();
  if (process.env['UPDATE_GOLDEN'] === '1') {
    mkdirSync(dirname(golden), { recursive: true });
    writeFileSync(golden, expected);
  }
  expect(existsSync(golden) ? readFileSync(golden, 'utf8') : '').toBe(expected);
});
