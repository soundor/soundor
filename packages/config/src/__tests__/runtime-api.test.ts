/**
 * The runtime API's contract, as `runtime-api.json` records it: the
 * declarations (interfaces and types) of what a runtime depends on of its
 * host, each hashed without its comments, and the version metadata the
 * pending release ships. A change to one fails this test until the record is
 * updated, so whoever changes the contract decides whether runtimes can
 * notice, and marks the pending change if so.
 *
 *   UPDATE_RUNTIME_API=1 pnpm --filter @soundor/config test
 *
 * The command re-records the declarations and writes the version numbers in
 * `src/version.ts` from the record's metadata. `version.ts` is never edited
 * by hand: a PR that changes the contract sets `"next"` in the record
 * (`"raise"`, or `"break"` when older runtimes cannot run), or, when runtimes
 * cannot notice, re-records without a pending change and the version stays.
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
const versionSource = join(configRoot, 'src/version.ts');

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
  'core/history.ts': join(coreRoot, 'src/history.ts'),
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

/** What the record must say, and what the version constants follow from. */
interface RuntimeApiRecord {
  released: number;
  min: number;
  next: null | 'raise' | 'break';
  declarations: Record<string, string>;
}

function checkMetadata(raw: RuntimeApiRecord): void {
  expect(
    raw.next === null || raw.next === 'raise' || raw.next === 'break',
    `"next" in runtime-api.json is ${JSON.stringify(raw.next)}; it is null, "raise" or "break".`,
  ).toBe(true);
  expect(
    Number.isInteger(raw.released) && raw.released >= 1,
    `"released" in runtime-api.json is ${JSON.stringify(raw.released)}; it is the last published line's version.`,
  ).toBe(true);
  expect(
    Number.isInteger(raw.min) && raw.min >= 1 && raw.min <= raw.released,
    `"min" in runtime-api.json is ${JSON.stringify(raw.min)}; it is at least 1 and at most "released".`,
  ).toBe(true);
}

/** The version numbers `src/version.ts` shows while the pending change ships. */
export function pendingVersions(record: RuntimeApiRecord): {
  version: number;
  min: number;
} {
  return {
    version: record.released + (record.next === null ? 0 : 1),
    min: record.next === 'break' ? record.released + 1 : record.min,
  };
}

/** Writes the version numbers `src/version.ts` shows from the record. */
export function writeVersionSource(
  versions: { version: number; min: number },
  text: string,
): string {
  const written = text
    .replace(
      /export const RUNTIME_API_VERSION = \d+;/,
      `export const RUNTIME_API_VERSION = ${versions.version};`,
    )
    .replace(
      /export const MIN_RUNTIME_API_VERSION = \d+;/,
      `export const MIN_RUNTIME_API_VERSION = ${versions.min};`,
    );
  if (
    !written.includes(
      `export const RUNTIME_API_VERSION = ${versions.version};`,
    ) ||
    !written.includes(`export const MIN_RUNTIME_API_VERSION = ${versions.min};`)
  )
    throw new Error(
      `${versionSource} does not have the two version constants to write; restore it.`,
    );
  return written;
}

function versionConstants(text: string): { version: number; min: number } {
  const version = /export const RUNTIME_API_VERSION = (\d+);/.exec(text)?.[1];
  const min = /export const MIN_RUNTIME_API_VERSION = (\d+);/.exec(text)?.[1];
  if (version === undefined || min === undefined)
    throw new Error(
      `${versionSource} does not have the two version constants; restore it.`,
    );
  return { version: Number(version), min: Number(min) };
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

  it('is the contract runtime-api.json records for the pending release', () => {
    const raw = JSON.parse(readFileSync(record, 'utf8')) as RuntimeApiRecord;
    checkMetadata(raw);
    const now: RuntimeApiRecord = {
      released: raw.released,
      min: raw.min,
      next: raw.next,
      declarations: current(),
    };
    const versions = pendingVersions(now);
    if (process.env['UPDATE_RUNTIME_API'] === '1') {
      writeFileSync(
        record,
        `${JSON.stringify(
          {
            released: now.released,
            min: now.min,
            next: now.next,
            declarations: now.declarations,
          },
          null,
          2,
        )}\n`,
      );
      writeFileSync(
        versionSource,
        writeVersionSource(versions, readFileSync(versionSource, 'utf8')),
      );
    } else {
      const changed = [
        ...new Set([
          ...Object.keys(now.declarations),
          ...Object.keys(raw.declarations),
        ]),
      ].filter((name) => now.declarations[name] !== raw.declarations[name]);
      expect(
        changed,
        `The runtime API's contract changed: ${changed.join(', ')}. If runtimes can notice, set "next" in packages/config/runtime-api.json to "raise" (a compatible addition; tag a new config field in CONFIG_FEATURES) or "break" (older runtimes cannot run). If they cannot, re-record without a pending change. Then: UPDATE_RUNTIME_API=1 pnpm --filter @soundor/config test`,
      ).toEqual([]);
      expect(
        versionConstants(readFileSync(versionSource, 'utf8')),
        `src/version.ts's constants are not what the record derives (${versions.version}/${versions.min}). The file is written from runtime-api.json; run UPDATE_RUNTIME_API=1 pnpm --filter @soundor/config test, and never edit the numbers by hand.`,
      ).toEqual(versions);
      expect({
        version: RUNTIME_API_VERSION,
        min: MIN_RUNTIME_API_VERSION,
      }).toEqual(versions);
    }
  });
});
