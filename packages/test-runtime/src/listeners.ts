/**
 * A listener list for values that change often (parameters, the transport):
 * notifying allocates nothing. Subscribing and unsubscribing replace the
 * array instead, so a notification in progress keeps the listeners it began
 * with, whoever (un)subscribes meanwhile, as in the JUCE runtime.
 */
export class Listeners<Value> {
  #entries: readonly { readonly listener: (value: Value) => void }[] = [];

  clear(): void {
    this.#entries = [];
  }

  get size(): number {
    return this.#entries.length;
  }

  /**
   * Adds `listener`; the returned function removes this subscription only
   * (subscribing one function twice makes two).
   */
  add(listener: (value: Value) => void, what: string): () => void {
    if (typeof listener !== 'function') {
      throw new TypeError(`${what} expects a function`);
    }
    const entry = { listener };
    this.#entries = [...this.#entries, entry];
    return () => {
      this.#entries = this.#entries.filter((other) => other !== entry);
    };
  }

  /** Notify from a snapshot and propagate errors to the test runner. */
  notify(value: Value): void {
    const errors: unknown[] = [];
    for (const entry of this.#entries) {
      try {
        entry.listener(value);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1)
      throw new AggregateError(errors, 'Soundor subscription errors');
  }
}
