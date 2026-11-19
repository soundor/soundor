// Writes native/src/generated/ExpressionRuntime.h: the helpers compiled
// expressions call (@soundor/expression's cppRuntime()), which the adapter's
// interpreter calls too, so it computes what the compilers' output computes.
// `pnpm --filter @soundor/vst3-runtime gen:expression`; a unit test
// (src/expression-runtime.test.ts) checks the file is current.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderExpressionRuntime } from '../src/expression-runtime.ts';

const target = fileURLToPath(
  new URL('../native/src/generated/ExpressionRuntime.h', import.meta.url),
);
writeFileSync(target, renderExpressionRuntime());
console.log(`Wrote ${target}`);
