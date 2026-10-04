// Event, CustomEvent and EventTarget: the DOM event model without the DOM.
// A plain EventTarget has no parent, so an event reaches its target only.
// Targets that form a tree (soundor:ui nodes) define `[eventParent]()`, and
// events then run the DOM's capture, target and bubble phases along it.

import { now } from 'soundor:internal/platform';
import { reportError } from 'soundor:internal/web/console';

const NONE = 0;
const CAPTURING_PHASE = 1;
const AT_TARGET = 2;
const BUBBLING_PHASE = 3;

/** The method by which a target names its parent in an event path. */
export const eventParent = Symbol('eventParent');

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
  #stoppedImmediately = false;
  #inPassiveListener = false;
  #trusted = false;
  #path = [];

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
    return this.#trusted;
  }
  get returnValue() {
    return !this.#defaultPrevented;
  }

  composedPath() {
    return this.#phase === NONE ? [] : [...this.#path];
  }

  preventDefault() {
    if (this.#cancelable && !this.#inPassiveListener)
      this.#defaultPrevented = true;
  }

  stopPropagation() {
    this.#stopped = true;
  }

  stopImmediatePropagation() {
    this.#stopped = true;
    this.#stoppedImmediately = true;
  }

  static {
    dispatchState = {
      begin(event, target, path) {
        if (event.#phase !== NONE) {
          throw new DOMException(
            'The event is already being dispatched',
            'InvalidStateError',
          );
        }
        event.#target = target;
        event.#path = path;
        event.#stopped = false;
        event.#stoppedImmediately = false;
      },
      at(event, currentTarget, phase) {
        event.#currentTarget = currentTarget;
        event.#phase = phase;
      },
      end(event) {
        event.#currentTarget = null;
        event.#phase = NONE;
        event.#path = [];
      },
      stopped: (event) => event.#stopped,
      stoppedImmediately: (event) => event.#stoppedImmediately,
      setPassive(event, passive) {
        event.#inPassiveListener = passive;
      },
      trust(event) {
        event.#trusted = true;
      },
    };
  }
}

/** Marks an event as coming from the user (native input), not from script. */
export function trustEvent(event) {
  dispatchState.trust(event);
  return event;
}

Event.NONE = NONE;
Event.CAPTURING_PHASE = CAPTURING_PHASE;
Event.AT_TARGET = AT_TARGET;
Event.BUBBLING_PHASE = BUBBLING_PHASE;

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
    const path = [this];
    for (let node = this[eventParent]?.(); node; node = node[eventParent]?.())
      path.push(node);
    dispatchState.begin(event, this, path);
    try {
      for (let i = path.length - 1; i > 0; --i) {
        if (dispatchState.stopped(event)) break;
        path[i].#invoke(event, CAPTURING_PHASE, true);
      }
      // At the target, capturing listeners run before the others.
      if (!dispatchState.stopped(event)) this.#invoke(event, AT_TARGET, true);
      if (!dispatchState.stopped(event)) this.#invoke(event, AT_TARGET, false);
      if (event.bubbles) {
        for (let i = 1; i < path.length; ++i) {
          if (dispatchState.stopped(event)) break;
          path[i].#invoke(event, BUBBLING_PHASE, false);
        }
      }
    } finally {
      dispatchState.end(event);
    }
    return !event.defaultPrevented;
  }

  #invoke(event, phase, capture) {
    const list = this.#listeners.get(event.type);
    if (list === undefined) return;
    dispatchState.at(event, this, phase);
    for (const entry of [...list]) {
      if (entry.removed || entry.capture !== capture) continue;
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
      if (dispatchState.stoppedImmediately(event)) break;
    }
  }
}
