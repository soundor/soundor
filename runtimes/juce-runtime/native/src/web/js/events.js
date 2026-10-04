// Event, CustomEvent and EventTarget: the DOM event model without the DOM.
// There is no tree, so an event is dispatched to its target only; capture and
// bubbling flags are accepted and have no effect.

import { now } from 'soundor:internal/platform';
import { reportError } from 'soundor:internal/web/console';

const NONE = 0;
const AT_TARGET = 2;

/** Lets EventTarget drive an event's dispatch state without making it public. */
let dispatchState;

export class Event {
  #type;
  #bubbles;
  #cancelable;
  #composed;
  #defaultPrevented = false;
  #target = null;
  #currentTarget = null;
  #phase = NONE;
  #timeStamp = now();
  #stopped = false;
  #inPassiveListener = false;

  constructor(type, init = {}) {
    if (arguments.length === 0) {
      throw new TypeError("Event constructor requires a 'type' argument");
    }
    this.#type = String(type);
    this.#bubbles = Boolean(init?.bubbles);
    this.#cancelable = Boolean(init?.cancelable);
    this.#composed = Boolean(init?.composed);
  }

  get type() {
    return this.#type;
  }
  get bubbles() {
    return this.#bubbles;
  }
  get cancelable() {
    return this.#cancelable;
  }
  get composed() {
    return this.#composed;
  }
  get defaultPrevented() {
    return this.#defaultPrevented;
  }
  get target() {
    return this.#target;
  }
  get srcElement() {
    return this.#target;
  }
  get currentTarget() {
    return this.#currentTarget;
  }
  get eventPhase() {
    return this.#phase;
  }
  get timeStamp() {
    return this.#timeStamp;
  }
  get isTrusted() {
    return false;
  }
  get returnValue() {
    return !this.#defaultPrevented;
  }

  composedPath() {
    return this.#currentTarget === null ? [] : [this.#currentTarget];
  }

  preventDefault() {
    if (this.#cancelable && !this.#inPassiveListener)
      this.#defaultPrevented = true;
  }

  stopPropagation() {}

  stopImmediatePropagation() {
    this.#stopped = true;
  }

  static {
    dispatchState = {
      begin(event, target) {
        if (event.#phase !== NONE) {
          throw new DOMException(
            'The event is already being dispatched',
            'InvalidStateError',
          );
        }
        event.#target = target;
        event.#currentTarget = target;
        event.#phase = AT_TARGET;
        event.#stopped = false;
      },
      end(event) {
        event.#currentTarget = null;
        event.#phase = NONE;
      },
      stopped: (event) => event.#stopped,
      setPassive(event, passive) {
        event.#inPassiveListener = passive;
      },
    };
  }
}

Event.NONE = 0;
Event.CAPTURING_PHASE = 1;
Event.AT_TARGET = 2;
Event.BUBBLING_PHASE = 3;

export class CustomEvent extends Event {
  #detail;

  constructor(type, init = {}) {
    super(type, init);
    this.#detail = init?.detail ?? null;
  }

  get detail() {
    return this.#detail;
  }
}

function normalizeOptions(options) {
  if (typeof options === 'boolean') return { capture: options };
  return options ?? {};
}

export class EventTarget {
  #listeners = new Map();

  addEventListener(type, listener, options) {
    if (listener === null || listener === undefined) return;
    if (
      typeof listener !== 'function' &&
      typeof listener?.handleEvent !== 'function'
    ) {
      throw new TypeError(
        'addEventListener() expects a function or an object with handleEvent()',
      );
    }
    const {
      capture = false,
      once = false,
      passive = false,
      signal,
    } = normalizeOptions(options);
    if (signal?.aborted) return;
    const key = String(type);
    let list = this.#listeners.get(key);
    if (list === undefined) {
      list = [];
      this.#listeners.set(key, list);
    }
    if (
      list.some(
        (entry) =>
          entry.listener === listener && entry.capture === Boolean(capture),
      )
    )
      return;
    const entry = {
      listener,
      capture: Boolean(capture),
      once,
      passive,
      removed: false,
    };
    list.push(entry);
    signal?.addEventListener(
      'abort',
      () => this.removeEventListener(key, listener, { capture }),
      {
        once: true,
      },
    );
  }

  removeEventListener(type, listener, options) {
    const { capture = false } = normalizeOptions(options);
    const list = this.#listeners.get(String(type));
    if (list === undefined) return;
    const index = list.findIndex(
      (entry) =>
        entry.listener === listener && entry.capture === Boolean(capture),
    );
    if (index < 0) return;
    list[index].removed = true;
    list.splice(index, 1);
  }

  dispatchEvent(event) {
    if (!(event instanceof Event)) {
      throw new TypeError('dispatchEvent() expects an Event');
    }
    dispatchState.begin(event, this);
    try {
      const list = this.#listeners.get(event.type);
      for (const entry of list === undefined ? [] : [...list]) {
        if (entry.removed) continue;
        if (entry.once)
          this.removeEventListener(event.type, entry.listener, entry);
        dispatchState.setPassive(event, entry.passive);
        try {
          if (typeof entry.listener === 'function')
            entry.listener.call(this, event);
          else entry.listener.handleEvent(event);
        } catch (error) {
          reportError(error);
        }
        dispatchState.setPassive(event, false);
        if (dispatchState.stopped(event)) break;
      }
    } finally {
      dispatchState.end(event);
    }
    return !event.defaultPrevented;
  }
}
