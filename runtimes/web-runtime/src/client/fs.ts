/**
 * `soundor:fs` over the plugin's database: a private file tree, never the
 * user's files. Paths and errors follow the JUCE runtime: relative,
 * '/'-separated paths that cannot leave the plugin's directory; failures are
 * DOMExceptions named as there (NotFoundError, TypeMismatchError, …). Each
 * operation is one transaction, so a write lands whole or not at all.
 */

import { result, STORES, transaction } from './persistence';

export interface DirectoryEntry {
  readonly name: string;
  readonly kind: 'file' | 'directory';
}

export interface FileStat {
  readonly kind: 'file' | 'directory';
  readonly size: number;
  /** Last modification, in milliseconds since the Unix epoch. */
  readonly modified: number;
}

/** What the database keeps per path ('' is the root, which always exists). */
interface Entry {
  readonly kind: 'file' | 'directory';
  readonly data?: Uint8Array;
  readonly modified: number;
}

export interface FileSystem {
  readBytes(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
  writeBytes(path: string, data: ArrayBuffer | ArrayBufferView): Promise<void>;
  writeText(path: string, text: string): Promise<void>;
  readDir(path?: string): Promise<DirectoryEntry[]>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  stat(path: string): Promise<FileStat | null>;
  exists(path: string): Promise<boolean>;
}

/**
 * The normalized form of a soundor:fs path ('' for the root), or a TypeError
 * for a path that is absolute, uses '\' or NUL, or climbs out with '..'.
 */
export function normalizePath(path: unknown): string {
  if (typeof path !== 'string')
    throw new TypeError('soundor:fs paths must be strings');
  const invalid = (problem: string): never => {
    throw new TypeError(`Invalid path '${path}': ${problem}`);
  };
  if (path.includes('\0') || path.includes('\\'))
    invalid("paths use '/' and cannot contain backslashes or NUL");
  if (path.startsWith('/') || path[1] === ':')
    invalid("paths are relative to the plugin's data directory");
  const parts: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '..')
      invalid("paths cannot leave the plugin's data directory");
    if (segment !== '' && segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}

const ERRORS = {
  NotFoundError: 'No such file or directory',
  TypeMismatchFile: 'Is a directory',
  TypeMismatchDirectory: 'Not a directory',
  Exists: 'File exists',
  NotEmpty: 'Directory not empty',
};

function failure(name: string, what: string, reason?: string): DOMException {
  return new DOMException(
    reason === undefined ? what : `${what}: ${reason}`,
    name,
  );
}

const parentOf = (path: string): string =>
  path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';

/** Every path strictly inside directory `path`, as a key range. */
function inside(path: string): IDBKeyRange | null {
  if (path === '') return null;
  return IDBKeyRange.bound(`${path}/`, `${path}/￿`);
}

function get(store: IDBObjectStore, path: string): Promise<Entry | undefined> {
  if (path === '') return Promise.resolve({ kind: 'directory', modified: 0 });
  return result(store.get(path) as IDBRequest<Entry | undefined>);
}

function bytesOf(data: unknown): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    );
  }
  throw new TypeError('writeBytes() expects an ArrayBuffer or a typed array');
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function createFileSystem(
  database: () => Promise<IDBDatabase>,
): FileSystem {
  const run = <T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T> => transaction(database(), STORES.files, mode, work);

  /** Creates `path`'s missing ancestors as directories. */
  const ensureParents = async (
    store: IDBObjectStore,
    path: string,
    what: string,
  ): Promise<void> => {
    const parts = path.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      const entry = await get(store, dir);
      if (entry === undefined) {
        await result(
          store.put({ kind: 'directory', modified: Date.now() }, dir),
        );
      } else if (entry.kind !== 'directory') {
        throw failure('TypeMismatchError', what, ERRORS.TypeMismatchDirectory);
      }
    }
  };

  const fs: FileSystem = {
    /** The file's bytes. */
    async readBytes(file) {
      const path = normalizePath(file);
      const what = `cannot read '${path}'`;
      const entry = await run('readonly', (store) => get(store, path));
      if (entry === undefined)
        throw failure('NotFoundError', what, ERRORS.NotFoundError);
      if (entry.kind === 'directory')
        throw failure('TypeMismatchError', what, ERRORS.TypeMismatchFile);
      return new Uint8Array(entry.data ?? new Uint8Array());
    },

    /** The file's contents, decoded as UTF-8. */
    async readText(file) {
      return decoder.decode(await fs.readBytes(file));
    },

    /** Replaces the file atomically, creating missing parent directories. */
    async writeBytes(file, data) {
      const path = normalizePath(file);
      const bytes = bytesOf(data);
      if (path === '')
        throw failure(
          'TypeMismatchError',
          'cannot write to the root directory',
        );
      const what = `cannot write '${path}'`;
      await run('readwrite', async (store) => {
        await ensureParents(store, path, what);
        const existing = await get(store, path);
        if (existing?.kind === 'directory')
          throw failure('TypeMismatchError', what, ERRORS.TypeMismatchFile);
        const entry: Entry = {
          kind: 'file',
          data: bytes,
          modified: Date.now(),
        };
        await result(store.put(entry, path));
      });
    },

    /** Writes `text` as UTF-8, atomically. */
    writeText(file, text) {
      return fs.writeBytes(file, encoder.encode(String(text)));
    },

    /** The directory's entries ({ name, kind }), sorted by name. */
    async readDir(directory = '.') {
      const path = normalizePath(directory);
      const what = `cannot list '${path}'`;
      return run('readonly', async (store) => {
        const entry = await get(store, path);
        if (entry === undefined)
          throw failure('NotFoundError', what, ERRORS.NotFoundError);
        if (entry.kind !== 'directory')
          throw failure(
            'TypeMismatchError',
            what,
            ERRORS.TypeMismatchDirectory,
          );
        const range = inside(path);
        const [keys, values] = await Promise.all([
          result(store.getAllKeys(range)),
          result(store.getAll(range) as IDBRequest<Entry[]>),
        ]);
        const prefix = path === '' ? '' : `${path}/`;
        const entries: DirectoryEntry[] = [];
        keys.forEach((key, index) => {
          const name = (key as string).slice(prefix.length);
          if (!name.includes('/'))
            entries.push({ name, kind: values[index]!.kind });
        });
        return entries.sort((a, b) =>
          a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
        );
      });
    },

    async mkdir(directory, options = {}) {
      const path = normalizePath(directory);
      const what = `cannot create '${path}'`;
      await run('readwrite', async (store) => {
        const existing = await get(store, path);
        if (options.recursive) {
          await ensureParents(store, `${path}/x`, what);
          return;
        }
        if (existing !== undefined)
          throw failure('InvalidModificationError', what, ERRORS.Exists);
        const parent = await get(store, parentOf(path));
        if (parent === undefined)
          throw failure('NotFoundError', what, ERRORS.NotFoundError);
        if (parent.kind !== 'directory')
          throw failure(
            'TypeMismatchError',
            what,
            ERRORS.TypeMismatchDirectory,
          );
        await result(
          store.put({ kind: 'directory', modified: Date.now() }, path),
        );
      });
    },

    /** Removes a file, or a directory (which must be empty unless `recursive`). */
    async remove(target, options = {}) {
      const path = normalizePath(target);
      if (path === '')
        throw failure('NotAllowedError', 'cannot remove the root directory');
      const what = `cannot remove '${path}'`;
      await run('readwrite', async (store) => {
        const entry = await get(store, path);
        if (entry === undefined)
          throw failure('NotFoundError', what, ERRORS.NotFoundError);
        if (entry.kind === 'directory') {
          const range = inside(path)!;
          if (!options.recursive && (await result(store.count(range))) > 0)
            throw failure('InvalidModificationError', what, ERRORS.NotEmpty);
          await result(store.delete(range));
        }
        await result(store.delete(path));
      });
    },

    /** { kind, size, modified } of an entry, or null if it does not exist. */
    async stat(target) {
      const path = normalizePath(target);
      const entry = await run('readonly', (store) => get(store, path));
      if (entry === undefined) return null;
      return {
        kind: entry.kind,
        size: entry.data?.byteLength ?? 0,
        modified: entry.modified,
      };
    },

    async exists(target) {
      return (await fs.stat(target)) !== null;
    },
  };
  return Object.freeze(fs);
}
