// soundor:internal/native-streams: the `streams` of a plugin's
// soundor:native, and the update function its bindings call on the UI thread
// with the newest value of a stream (js::deliverStreams()).
//
// A stream keeps its latest value for get() and calls its subscribers with
// each newer one. Subscribing during an update takes effect from the next; a
// subscriber removed during one is not called again. A subscriber's exception
// is reported and the others still run.

/**
 * @param {readonly string[]} names the streams, in the order of their numbers
 * @param {(error: unknown) => void} reportError
 */
export function createStreams(names, reportError) {
  /**
   * @type {{ value: unknown, subscribers: Set<{ listener: (value: unknown, sequence: number) => void, active: boolean }> }[]}
   */
  const states = names.map(() => ({
    value: undefined,
    subscribers: new Set(),
  }));

  // Closures, not methods: get and subscribe work unbound
  // (useSyncExternalStore(stream.subscribe, stream.get)).
  const stream = (name, state) =>
    Object.freeze({
      get: () => state.value,
      subscribe: (listener) => {
        if (typeof listener !== 'function') {
          throw new TypeError(
            `streams.${name}.subscribe() expects a function, got ${listener === null ? 'null' : typeof listener}`,
          );
        }
        const entry = { listener, active: true };
        state.subscribers.add(entry);
        return () => {
          entry.active = false;
          state.subscribers.delete(entry);
        };
      },
    });

  const streams = Object.freeze(
    Object.fromEntries(
      names.map((name, index) => [name, stream(name, states[index])]),
    ),
  );

  // Sets stream number `index` to `value`, the producer's publication number
  // `sequence`, and calls its subscribers when `notify`.
  const update = (index, value, sequence, notify) => {
    const state = states[index];
    if (state === undefined) return;
    state.value = value;
    if (!notify || state.subscribers.size === 0) return;
    for (const entry of [...state.subscribers]) {
      if (!entry.active) continue;
      try {
        entry.listener(value, sequence);
      } catch (error) {
        reportError(error);
      }
    }
  };

  return { streams, update };
}
