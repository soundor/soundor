/**
 * The plugin's persistent data in the browser: one IndexedDB database per
 * plugin id, so plugins on the same site never share data. It holds the
 * `soundor:storage` entries and the `soundor:fs` files. IndexedDB is
 * asynchronous like both APIs, and a transaction makes every write atomic.
 */

/** The object stores: storage entries (JSON text) and fs entries. */
export const STORES = { storage: 'storage', files: 'files' } as const;

/** A database per plugin; each opened once per page. */
const databases = new Map<string, Promise<IDBDatabase>>();

/** The database of the plugin `pluginId`. */
export function pluginDatabase(pluginId: string): Promise<IDBDatabase> {
  let database = databases.get(pluginId);
  if (database === undefined) {
    database = open(`soundor/${pluginId}`);
    databases.set(pluginId, database);
    // A failure is not cached: a later call tries again.
    database.catch(() => databases.delete(pluginId));
  }
  return database;
}

function open(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(name, 1);
    } catch (error) {
      reject(unavailable(error));
      return;
    }
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORES.storage);
      request.result.createObjectStore(STORES.files);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(unavailable(request.error));
    request.onblocked = () =>
      reject(unavailable(new Error('the database is blocked')));
  });
}

function unavailable(cause: unknown): Error {
  return new Error(
    `The browser's storage (IndexedDB) is not available to this page, so soundor:storage and soundor:fs cannot work: ${cause instanceof Error ? cause.message : String(cause)}`,
    { cause },
  );
}

/** A request's result, as a promise. */
export function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Runs `work` in one transaction and resolves with its value once the
 * transaction has committed (or rejects, with nothing written).
 */
export async function transaction<T>(
  database: Promise<IDBDatabase>,
  store: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const tx = (await database).transaction(store, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error ?? new DOMException('Aborted', 'AbortError'));
  });
  let value: T;
  try {
    value = await work(tx.objectStore(store));
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // Already finished.
    }
    await done.catch(() => {});
    throw error;
  }
  await done;
  return value;
}
