/**
 * `soundor:storage` over the plugin's database: small, persistent key/value
 * storage of JSON data. Every operation lands before its promise resolves.
 */

import { result, STORES, transaction } from './persistence';

function key(value: unknown): string {
  if (typeof value !== 'string')
    throw new TypeError('Storage keys must be strings');
  return value;
}

export interface Storage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

export function createStorage(database: () => Promise<IDBDatabase>): Storage {
  const run = <T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T> => transaction(database(), STORES.storage, mode, work);

  return Object.freeze({
    /** The stored value, or undefined. */
    async get<T>(name: string): Promise<T | undefined> {
      const text = await run('readonly', (store) =>
        result(store.get(key(name)) as IDBRequest<string | undefined>),
      );
      return text === undefined ? undefined : (JSON.parse(text) as T);
    },

    /** Stores a JSON-serializable value. */
    async set(name: string, value: unknown): Promise<void> {
      const id = key(name);
      const text = JSON.stringify(value);
      if (text === undefined) {
        throw new TypeError(
          `soundor:storage cannot store ${typeof value} values; store JSON data`,
        );
      }
      await run('readwrite', (store) => result(store.put(text, id)));
    },

    async delete(name: string): Promise<void> {
      const id = key(name);
      await run('readwrite', (store) => result(store.delete(id)));
    },

    /** Every stored key, sorted. */
    async keys(): Promise<string[]> {
      const keys = await run('readonly', (store) => result(store.getAllKeys()));
      return (keys as string[]).sort();
    },

    async clear(): Promise<void> {
      await run('readwrite', (store) => result(store.clear()));
    },
  });
}
