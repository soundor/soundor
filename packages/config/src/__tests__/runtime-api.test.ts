/**
 * The runtime API's contract, as `runtime-api.json` records it: the
 * declarations (interfaces and types) of what a runtime depends on of its
 * host, each hashed without its comments. A change to one fails this test
 * until the record is updated, so whoever changes the contract decides
 * whether runtimes can notice, and raises `RUNTIME_API_VERSION` if so.
 *
 *   UPDATE_RUNTIME_API=1 pnpm --filter @soundor/config test
 */

import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MIN_RUNTIME_API_VERSION, RUNTIME_API_VERSION } from '../version';

const configRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const coreRoot = realpathSync(join(configRoot, 'node_modules/@soundor/core'));
const expressionRoot = realpathSync(
  join(configRoot, 'node_modules/@soundor/expression'),
);
const record = join(configRoot, 'runtime-api.json');

/** The files whose declarations make the contract. */
const CONTRACT: Record<string, string> = {
  // The Runtime interface, its context, and the config it receives.
  'config/runtime.ts': join(configRoot, 'src/runtime.ts'),
  'config/context.ts': join(configRoot, 'src/context.ts'),
  'config/types.ts': join(configRoot, 'src/types.ts'),
  'config/parameters.ts': join(configRoot, 'src/parameters.ts'),
  'config/editor.ts': join(configRoot, 'src/editor.ts'),
  'config/signing.ts': join(configRoot, 'src/signing.ts'),
  // The seams the context carries, the native API, and the error protocol.
  'core/logger.ts': join(coreRoot, 'src/logger.ts'),
  'core/filesystem.ts': join(coreRoot, 'src/filesystem.ts'),
  'core/codegen.ts': join(coreRoot, 'src/codegen.ts'),
  'core/paths.ts': join(coreRoot, 'src/paths.ts'),
  'core/state.ts': join(coreRoot, 'src/state.ts'),
  'core/setter.ts': join(coreRoot, 'src/setter.ts'),
  'core/native-api.ts': join(coreRoot, 'src/native-api.ts'),
  'core/errors.ts': join(coreRoot, 'src/errors.ts'),
  // The parameters' expressions, and the compilers runtimes turn them into code with.
  'expression/types.ts': join(expressionRoot, 'src/types.ts'),
  'expression/ast.ts': join(expressionRoot, 'src/ast.ts'),
  'expression/check.ts': join(expressionRoot, 'src/check.ts'),
  'expression/compiler/cpp.ts': join(expressionRoot, 'src/compiler/cpp.ts'),
  'expression/compiler/js.ts': join(expressionRoot, 'src/compiler/js.ts'),
};

/** The text without comments, its whitespace collapsed. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    .replace(/\s+/g, ' ');
}

/** Every `interface` and `type` declared at the top level of `text`. */
export function declarations(text: string): Map<string, string> {
  const source = code(text);
  const found = new Map<string, string>();
  const start = /(?:^|[;}])\s*(?:export )?(interface|type) ([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(start)) {
    const from = match.index + match[0].indexOf(match[1]!);
    let depth = 0;
    let end = from;
    for (; end < source.length; end++) {
      const char = source[end]!;
      if ('{(<['.includes(char)) depth++;
      // The > of an arrow (=>) closes nothing.
      else if (
        '})>]'.includes(char) &&
        !(char === '>' && source[end - 1] === '=')
      ) {
        depth--;
        if (match[1] === 'interface' && depth === 0 && char === '}') break;
      } else if (match[1] === 'type' && depth === 0 && char === ';') break;
    }
    found.set(match[2]!, source.slice(from, end + 1).trim());
  }
  return found;
}

function current(): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const [file, path] of Object.entries(CONTRACT)) {
    for (const [name, declaration] of declarations(readFileSync(path, 'utf8')))
      hashes[`${file}#${name}`] = createHash('sha256')
        .update(declaration)
        .digest('hex')
        .slice(0, 12);
  }
  return Object.fromEntries(Object.entries(hashes).sort());
}

describe('the runtime API', () => {
  it('finds declarations without their comments', () => {
    const found = declarations(`
      /** Docs. */
      export interface A { b: string; // trailing
        c(): { d: number }; }
      type E = 'x' | Array<{ f: (g: string) => void }>;
      export const g = 1;`);
    expect([...found.keys()]).toEqual(['A', 'E']);
    expect(found.get('A')).toBe(
      'interface A { b: string; c(): { d: number }; }',
    );
    expect(found.get('E')).toBe(
      "type E = 'x' | Array<{ f: (g: string) => void }>;",
    );
  });

  it('is the contract runtime-api.json records for its version', () => {
    const now = {
      version: RUNTIME_API_VERSION,
      min: MIN_RUNTIME_API_VERSION,
      declarations: current(),
    };
    if (process.env['UPDATE_RUNTIME_API'] === '1')
      writeFileSync(record, `${JSON.stringify(now, null, 2)}\n`);
    const recorded = JSON.parse(readFileSync(record, 'utf8')) as typeof now;
    const changed = [
      ...new Set([
        ...Object.keys(now.declarations),
        ...Object.keys(recorded.declarations),
      ]),
    ].filter((name) => now.declarations[name] !== recorded.declarations[name]);
    expect(
      changed,
      `The runtime API's contract changed: ${changed.join(', ')}. If a runtime could notice, raise RUNTIME_API_VERSION (and MIN_RUNTIME_API_VERSION for a break; tag a new config field in CONFIG_FEATURES). Then record it: UPDATE_RUNTIME_API=1 pnpm --filter @soundor/config test`,
    ).toEqual([]);
    expect({ version: now.version, min: now.min }).toEqual({
      version: recorded.version,
      min: recorded.min,
    });
  });
});
