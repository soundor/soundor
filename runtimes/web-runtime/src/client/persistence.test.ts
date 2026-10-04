import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';

import { createFileSystem, normalizePath } from './fs';
import { pluginDatabase } from './persistence';
import { createStorage } from './storage';

const counter = { next: 0 };
/** Storage and files of a plugin no other test uses. */
function plugin(id = `com.example.plugin${counter.next++}`) {
  const database = () => pluginDatabase(id);
  return {
    id,
    storage: createStorage(database),
    fs: createFileSystem(database),
  };
}

/** Reads a store of a plugin's database directly, as a later visit would. */
async function stored(id: string, store: string): Promise<IDBValidKey[]> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`soundor/${id}`);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise((resolve, reject) => {
    const request = database.transaction(store).objectStore(store).getAllKeys();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

describe('soundor:storage', () => {
  it('stores JSON values by key', async () => {
    const { storage } = plugin();
    expect(await storage.get('missing')).toBeUndefined();
    await storage.set('preset', { name: 'Warm', gain: 0.7 });
    await storage.set('count', 3);
    await storage.set('flag', null);
    expect(await storage.get('preset')).toEqual({ name: 'Warm', gain: 0.7 });
    expect(await storage.get('flag')).toBeNull();
    expect(await storage.keys()).toEqual(['count', 'flag', 'preset']);
    await storage.delete('count');
    expect(await storage.keys()).toEqual(['flag', 'preset']);
    await storage.clear();
    expect(await storage.keys()).toEqual([]);
  });

  it('persists in the plugin database', async () => {
    const { id, storage } = plugin();
    await storage.set('a', 1);
    expect(await stored(id, 'storage')).toEqual(['a']);
  });

  it('keeps plugins on one site apart', async () => {
    const one = plugin('com.example.one');
    const two = plugin('com.example.two');
    await one.storage.set('shared', 'one');
    await two.storage.set('shared', 'two');
    expect(await one.storage.get('shared')).toBe('one');
    expect(await two.storage.get('shared')).toBe('two');
    await one.fs.writeText('a.txt', 'one');
    expect(await two.fs.exists('a.txt')).toBe(false);
  });

  it('rejects what JSON cannot hold and non-string keys', async () => {
    const { storage } = plugin();
    await expect(storage.set('fn', () => {})).rejects.toThrow(
      new TypeError(
        'soundor:storage cannot store function values; store JSON data',
      ),
    );
    await expect(storage.get(1 as unknown as string)).rejects.toThrow(
      new TypeError('Storage keys must be strings'),
    );
  });
});

describe('soundor:fs paths', () => {
  it.each([
    ['presets/warm.json', 'presets/warm.json'],
    ['./a//b/./c', 'a/b/c'],
    ['.', ''],
    ['', ''],
  ])('normalizes %j to %j', (path, normalized) => {
    expect(normalizePath(path)).toBe(normalized);
  });

  it.each([
    ['../outside', "paths cannot leave the plugin's data directory"],
    ['a/../../b', "paths cannot leave the plugin's data directory"],
    ['a/..', "paths cannot leave the plugin's data directory"],
    ['/etc/passwd', "paths are relative to the plugin's data directory"],
    ['C:/Windows', "paths are relative to the plugin's data directory"],
    ['a\\b', "paths use '/' and cannot contain backslashes or NUL"],
    ['a\0b', "paths use '/' and cannot contain backslashes or NUL"],
  ])('rejects %j', async (path, problem) => {
    const { fs } = plugin();
    await expect(fs.readText(path)).rejects.toThrow(
      new TypeError(`Invalid path '${path}': ${problem}`),
    );
    await expect(fs.writeText(path, 'x')).rejects.toThrow(TypeError);
  });

  it('rejects paths that are not strings', async () => {
    const { fs } = plugin();
    await expect(fs.stat(3 as unknown as string)).rejects.toThrow(
      new TypeError('soundor:fs paths must be strings'),
    );
  });
});

describe('soundor:fs files', () => {
  it('round-trips bytes and text, creating parent directories', async () => {
    const { fs } = plugin();
    const bytes = new Uint8Array([0, 1, 254, 255]);
    await fs.writeBytes('data/raw.bin', bytes);
    bytes[0] = 9; // the file kept its own copy
    expect(await fs.readBytes('data/raw.bin')).toEqual(
      new Uint8Array([0, 1, 254, 255]),
    );
    await fs.writeBytes('view.bin', new Uint16Array([1, 2]).subarray(1));
    expect(await fs.readBytes('view.bin')).toEqual(new Uint8Array([2, 0]));
    await fs.writeText('presets/warm.json', '{"gain":0.7} ✓');
    expect(await fs.readText('presets/warm.json')).toBe('{"gain":0.7} ✓');
    expect(await fs.stat('data')).toMatchObject({ kind: 'directory', size: 0 });
  });

  it('reports kind, size and modification time', async () => {
    const { fs } = plugin();
    const before = Date.now();
    await fs.writeText('a.txt', 'hello');
    const stat = await fs.stat('a.txt');
    expect(stat).toMatchObject({ kind: 'file', size: 5 });
    expect(stat!.modified).toBeGreaterThanOrEqual(before);
    expect(await fs.stat('nope')).toBeNull();
    expect(await fs.exists('a.txt')).toBe(true);
    expect(await fs.stat('')).toMatchObject({ kind: 'directory' });
  });

  it('fails like the JUCE runtime, with DOMExceptions', async () => {
    const { fs } = plugin();
    await fs.writeText('dir/file.txt', 'x');
    await expect(fs.readBytes('missing.txt')).rejects.toMatchObject({
      name: 'NotFoundError',
      message: "cannot read 'missing.txt': No such file or directory",
    });
    await expect(fs.readBytes('dir')).rejects.toMatchObject({
      name: 'TypeMismatchError',
    });
    await expect(fs.writeText('dir', 'x')).rejects.toMatchObject({
      name: 'TypeMismatchError',
    });
    await expect(fs.writeText('dir/file.txt/inner', 'x')).rejects.toMatchObject(
      {
        name: 'TypeMismatchError',
        message: "cannot write 'dir/file.txt/inner': Not a directory",
      },
    );
    await expect(fs.writeText('.', 'x')).rejects.toMatchObject({
      name: 'TypeMismatchError',
      message: 'cannot write to the root directory',
    });
    await expect(fs.writeBytes('x', 'text' as never)).rejects.toThrow(
      new TypeError('writeBytes() expects an ArrayBuffer or a typed array'),
    );
  });

  it('writes atomically: a failed write leaves nothing behind', async () => {
    const { fs } = plugin();
    await fs.writeText('blocker', 'file');
    await expect(fs.writeText('blocker/a/b.txt', 'x')).rejects.toMatchObject({
      name: 'TypeMismatchError',
    });
    expect(await fs.readDir()).toEqual([{ name: 'blocker', kind: 'file' }]);
  });
});

describe('soundor:fs directories', () => {
  it('lists entries by name, one level deep', async () => {
    const { fs } = plugin();
    await fs.writeText('b.txt', '');
    await fs.writeText('a/deep/file.txt', '');
    await fs.writeText('a/top.txt', '');
    await fs.mkdir('c');
    expect(await fs.readDir()).toEqual([
      { name: 'a', kind: 'directory' },
      { name: 'b.txt', kind: 'file' },
      { name: 'c', kind: 'directory' },
    ]);
    expect(await fs.readDir('a')).toEqual([
      { name: 'deep', kind: 'directory' },
      { name: 'top.txt', kind: 'file' },
    ]);
    await expect(fs.readDir('b.txt')).rejects.toMatchObject({
      name: 'TypeMismatchError',
    });
    await expect(fs.readDir('nope')).rejects.toMatchObject({
      name: 'NotFoundError',
    });
  });

  it('makes directories, recursively or one at a time', async () => {
    const { fs } = plugin();
    await expect(fs.mkdir('x/y')).rejects.toMatchObject({
      name: 'NotFoundError',
    });
    await fs.mkdir('x/y', { recursive: true });
    await fs.mkdir('x/y', { recursive: true });
    await expect(fs.mkdir('x/y')).rejects.toMatchObject({
      name: 'InvalidModificationError',
      message: "cannot create 'x/y': File exists",
    });
    await fs.mkdir('x/z');
    expect((await fs.readDir('x')).map((entry) => entry.name)).toEqual([
      'y',
      'z',
    ]);
  });

  it('removes files and directories, recursively when asked', async () => {
    const { fs } = plugin();
    await fs.writeText('p/q/r.txt', 'x');
    await fs.writeText('p2.txt', 'x');
    await expect(fs.remove('p')).rejects.toMatchObject({
      name: 'InvalidModificationError',
      message: "cannot remove 'p': Directory not empty",
    });
    await fs.remove('p', { recursive: true });
    expect(await fs.exists('p/q/r.txt')).toBe(false);
    expect(await fs.exists('p')).toBe(false);
    // A sibling whose name starts the same is untouched.
    expect(await fs.exists('p2.txt')).toBe(true);
    await fs.remove('p2.txt');
    await expect(fs.remove('p2.txt')).rejects.toMatchObject({
      name: 'NotFoundError',
    });
    await expect(fs.remove('.')).rejects.toMatchObject({
      name: 'NotAllowedError',
    });
  });
});
