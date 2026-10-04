import { report } from './report';

/**
 * A listener list for values that change often (parameters, the transport):
 * notifying allocates nothing. Subscribing and unsubscribing replace the
 * array instead, so a notification in progress keeps the listeners it began
 * with, whoever (un)subscribes meanwhile, as in the JUCE runtime.
 */
export class Listeners<Value> {
  #entries: readonly { readonly listener: (value: Value) => void }[] = [];

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

  /** Calls every listener; one that throws is reported and the rest run. */
  notify(value: Value): void {
    const entries = this.#entries;
    for (let i = 0; i < entries.length; i++) {
      try {
        entries[i]!.listener(value);
      } catch (error) {
        report(error);
      }
    }
  }
}
