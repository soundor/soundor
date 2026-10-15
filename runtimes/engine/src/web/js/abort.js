// AbortController and AbortSignal.

import { Event, EventTarget } from 'soundor:internal/web/events';
import { setTimeout } from 'soundor:internal/web/timers';

let creating = false;
/** Aborts a signal from AbortController without a public method. */
let abortSignal;

export class AbortSignal extends EventTarget {
  #aborted = false;
  #reason = undefined;
  #onabort = null;

  constructor() {
    if (!creating) throw new TypeError('Illegal constructor');
    super();
  }

  get aborted() {
    return this.#aborted;
  }
  get reason() {
    return this.#reason;
  }

  get onabort() {
    return this.#onabort;
  }
  set onabort(handler) {
    if (this.#onabort) this.removeEventListener('abort', this.#onabort);
    this.#onabort = typeof handler === 'function' ? handler : null;
    if (this.#onabort) this.addEventListener('abort', this.#onabort);
  }

  throwIfAborted() {
    if (this.#aborted) throw this.#reason;
  }

  static abort(reason) {
    const signal = createSignal();
    signal.#abort(reason);
    return signal;
  }

  static timeout(milliseconds) {
    const signal = createSignal();
    setTimeout(
      () =>
        signal.#abort(
          new DOMException('The operation timed out.', 'TimeoutError'),
        ),
      milliseconds,
    );
    return signal;
  }

  static any(signals) {
    const signal = createSignal();
    const sources = [...signals];
    const aborted = sources.find((source) => source.aborted);
    if (aborted) {
      signal.#abort(aborted.reason);
      return signal;
    }
    const controller = new AbortController();
    for (const source of sources) {
      source.addEventListener('abort', () => signal.#abort(source.reason), {
        once: true,
        signal: controller.signal,
      });
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
    return signal;
  }

  static {
    abortSignal = (signal, reason) => signal.#abort(reason);
  }

  #abort(reason) {
    if (this.#aborted) return;
    this.#aborted = true;
    this.#reason =
      reason === undefined
        ? new DOMException('This operation was aborted', 'AbortError')
        : reason;
    this.dispatchEvent(new Event('abort'));
  }
}

function createSignal() {
  creating = true;
  try {
    return new AbortSignal();
  } finally {
    creating = false;
  }
}

export class AbortController {
  #signal = createSignal();

  get signal() {
    return this.#signal;
  }

  abort(reason) {
    abortSignal(this.#signal, reason);
  }
}
