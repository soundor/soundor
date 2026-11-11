/** A direct value or a synchronous computation from the latest stored value. */
export type ValueOrUpdater<T> = T | ((current: T) => T);

/** Resolve once, before validation or publication. Stores supply their authoritative read. */
export function resolveSetter(value: unknown, current: () => unknown): unknown {
  const result = typeof value === 'function' ? value(current()) : value;
  if (
    result !== null &&
    (typeof result === 'object' || typeof result === 'function') &&
    typeof result.then === 'function'
  )
    throw new TypeError(
      'Setters require synchronous values, not promises or thenables',
    );
  return result;
}
