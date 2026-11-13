// soundor:internal/native-events: the `events` of a plugin's soundor:native,
// its subscribers, and the dispatcher its generated bindings call on the UI
// thread with each event native code published (js::deliverEvents()).
//
// Subscribing during a dispatch takes effect from the next event; a
// subscriber removed during one is not called again, not even for the event
// in progress. A subscriber's exception is reported and the others still run.

/**
 * @param {readonly string[]} names the events, in the order of their numbers
 * @param {(error: unknown) => void} reportError
 */
export function createEvents(names, reportError) {
  /** @type {Set<{ listener: (value: unknown) => void, active: boolean }>[]} */
  const subscribers = names.map(() => new Set());

  const event = (name, index) =>
    Object.freeze({
      subscribe(listener) {
        if (typeof listener !== 'function') {
          throw new TypeError(
            `events.${name}.subscribe() expects a function, got ${listener === null ? 'null' : typeof listener}`,
          );
        }
        const entry = { listener, active: true };
        subscribers[index].add(entry);
        return () => {
          entry.active = false;
          subscribers[index].delete(entry);
        };
      },
    });

  const events = Object.freeze(
    Object.fromEntries(names.map((name, index) => [name, event(name, index)])),
  );

  const dispatch = (index, value) => {
    const listeners = subscribers[index];
    if (listeners === undefined || listeners.size === 0) return;
    for (const entry of [...listeners]) {
      if (!entry.active) continue;
      try {
        entry.listener(value);
      } catch (error) {
        reportError(error);
      }
    }
  };

  return { events, dispatch };
}
