import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bundleUi } from '../ui/bundle';
import { rewriteLocations, SourceMap } from './source-map';

const scratch = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../node_modules/.tmp',
);

let root: string;

beforeEach(async () => {
  await mkdir(scratch, { recursive: true });
  root = await mkdtemp(join(scratch, 'source-map-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('SourceMap', () => {
  it('decodes relative VLQ mappings', () => {
    // Fields are deltas from the previous segment:
    // line 1 col 0 -> a.ts 1:0; col 5 -> a.ts 1:5; line 2 col 0 -> b.ts 3:2.
    const map = new SourceMap(
      { version: 3, sources: ['a.ts', 'b.ts'], mappings: 'AAAA,KAAK;ACEH' },
      '/project/out',
      '/project',
    );
    expect(map.originalPosition(1, 1)).toEqual({
      source: 'out/a.ts',
      line: 1,
      column: 1,
    });
    expect(map.originalPosition(1, 9)).toEqual({
      source: 'out/a.ts',
      line: 1,
      column: 6,
    });
    expect(map.originalPosition(2, 4)).toEqual({
      source: 'out/b.ts',
      line: 3,
      column: 3,
    });
    expect(map.originalPosition(3, 1)).toBeUndefined();
  });

  it('maps QuickJS stack frames of a real development bundle to the TypeScript', async () => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(
      join(root, 'src/explode.ts'),
      [
        'type Reason = string;',
        '',
        'export function explode(reason: Reason): never {',
        '  throw new Error(reason);',
        '}',
        '',
      ].join('\n'),
    );
    await writeFile(
      join(root, 'src/main.ts'),
      "import { explode } from './explode';\nexplode('boom');\n",
    );
    const bundle = await bundleUi({
      root,
      mode: 'development',
      outDir: join(root, 'out'),
    });
    const code = await readFile(join(bundle!.dir, 'bundle.js'), 'utf8');
    const lines = code.split('\n');
    const line = lines.findIndex((text) => text.includes('throw new Error'));
    const column = lines[line]!.indexOf('throw');
    const map = await SourceMap.load(join(bundle!.dir, 'bundle.js.map'), root);

    // QuickJS frames are 1-based: "    at explode (/bundle.js:L:C)".
    const stack = `Error: boom\n    at explode (/bundle.js:${line + 1}:${column + 1})\n    at <anonymous> (native)`;
    expect(rewriteLocations(stack, map)).toBe(
      'Error: boom\n    at explode (src/explode.ts:4:3)\n    at <anonymous> (native)',
    );
  });

  it('leaves unknown locations alone', () => {
    const map = new SourceMap(
      { version: 3, sources: ['a.ts'], mappings: 'AAAA' },
      '/p',
      '/p',
    );
    expect(
      rewriteLocations('at f (/bundle.js:9:1) and /other.js:1:1', map),
    ).toBe('at f (/bundle.js:9:1) and /other.js:1:1');
  });
});
