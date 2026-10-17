import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { fileFor } from './static.ts';

const root = mkdtempSync(join(tmpdir(), 'static-'));
mkdirSync(join(root, 'examples/basic'), { recursive: true });
writeFileSync(join(root, 'examples/basic/index.html'), '');
writeFileSync(join(root, 'examples/basic/playground.json'), '{}');
writeFileSync(join(tmpdir(), 'outside.txt'), '');
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('fileFor', () => {
  it("serves files, and a folder's index.html", () => {
    expect(fileFor(root, '/examples/basic/playground.json')).toBe(
      join(root, 'examples/basic/playground.json'),
    );
    expect(fileFor(root, '/examples/basic/')).toBe(
      join(root, 'examples/basic/index.html'),
    );
    expect(fileFor(root, '/examples/basic')).toBe(
      join(root, 'examples/basic/index.html'),
    );
  });

  it('serves nothing that is not there', () => {
    expect(fileFor(root, '/examples/nope.json')).toBeUndefined();
    expect(fileFor(root, '/examples/')).toBeUndefined();
  });

  it('never serves a file outside its folder', () => {
    expect(fileFor(root, '/../outside.txt')).toBeUndefined();
    expect(fileFor(root, '/examples/../../outside.txt')).toBeUndefined();
    expect(fileFor(root, '/%2e%2e/outside.txt')).toBeUndefined();
  });
});
