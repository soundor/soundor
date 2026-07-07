import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNodeFileSystem, type FileSystemHost } from './filesystem';

describe('createNodeFileSystem', () => {
  let root: string;
  let fs: FileSystemHost;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'soundor-fs-'));
    fs = createNodeFileSystem(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('resolves relative paths against the root', () => {
    expect(fs.resolve('a', 'b.txt')).toBe(join(root, 'a', 'b.txt'));
  });

  it('writes (creating parents), reads, lists, checks, and removes', async () => {
    expect(await fs.exists('nested/file.txt')).toBe(false);

    await fs.write('nested/file.txt', 'hello');
    expect(await fs.exists('nested/file.txt')).toBe(true);
    expect(await fs.read('nested/file.txt')).toBe('hello');
    expect(await fs.readdir('nested')).toEqual(['file.txt']);

    await fs.rm('nested');
    expect(await fs.exists('nested/file.txt')).toBe(false);
  });

  it('rm ignores a missing path', async () => {
    await expect(fs.rm('does/not/exist')).resolves.toBeUndefined();
  });
});
