/**
 * Events along the `soundor:ui` tree. A node is an EventTarget whose events
 * run the DOM's capture, target and bubble phases along the Soundor tree, as
 * in the JUCE runtime: listeners see UiNodes as `target` and
 * `currentTarget`, never the DOM elements that draw them.
 *
 * Events are the browser's own Event objects (and the subclasses below); a
 * dispatch shadows their `target`, `currentTarget`, `eventPhase` and
 * propagation methods for its duration.
 */

const NONE = 0;
const CAPTURING_PHASE = 1;
const AT_TARGET = 2;
const BUBBLING_PHASE = 3;

/** How a target names its parent in an event path. */
export const eventParent = Symbol('eventParent');

type Listener = EventListenerOrEventListenerObject;

interface Entry {
  readonly listener: Listener;
  readonly capture: boolean;
  readonly once: boolean;
  readonly passive: boolean;
  removed: boolean;
}

interface DispatchState {
  currentTarget: TreeEventTarget | null;
  phase: number;
  stopped: boolean;
  stoppedImmediately: boolean;
  passive: boolean;
  path: TreeEventTarget[];
}

/** Events being dispatched, so one cannot be dispatched twice at once. */
const dispatching = new WeakSet<Event>();

function options(value: boolean | AddEventListenerOptions | undefined) {
  return typeof value === 'boolean' ? { capture: value } : (value ?? {});
}

/** An EventTarget whose events propagate along `[eventParent]()`. */
export class TreeEventTarget extends EventTarget {
  readonly #listeners = new Map<string, Entry[]>();

  override addEventListener(
    type: string,
    listener: Listener | null,
    init?: boolean | AddEventListenerOptions,
  ): void {
    if (listener === null || listener === undefined) return;
    if (
      typeof listener !== 'function' &&
      typeof listener.handleEvent !== 'function'
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
    } = options(init);
    if (signal?.aborted) return;
    let list = this.#listeners.get(type);
    if (list === undefined) {
      list = [];
      this.#listeners.set(type, list);
    }
    if (list.some((e) => e.listener === listener && e.capture === capture))
      return;
    list.push({ listener, capture, once, passive, removed: false });
    signal?.addEventListener(
      'abort',
      () => this.removeEventListener(type, listener, { capture }),
      { once: true },
    );
  }

  override removeEventListener(
    type: string,
    listener: Listener | null,
    init?: boolean | EventListenerOptions,
  ): void {
    const capture = options(init).capture ?? false;
    const list = this.#listeners.get(type);
    if (list === undefined) return;
    const index = list.findIndex(
      (entry) => entry.listener === listener && entry.capture === capture,
    );
    if (index < 0) return;
    list[index]!.removed = true;
    list.splice(index, 1);
  }

  /** Dispatches `event` along the tree; false if a listener prevented it. */
  override dispatchEvent(event: Event): boolean {
    if (!(event instanceof Event)) {
      throw new TypeError('dispatchEvent() expects an Event');
    }
    if (dispatching.has(event)) {
      throw new DOMException(
        'The event is already being dispatched',
        'InvalidStateError',
      );
    }
    const path: TreeEventTarget[] = [this];
    for (let node = this[eventParent](); node; node = node[eventParent]())
      path.push(node);
    const state: DispatchState = {
      currentTarget: null,
      phase: NONE,
      stopped: false,
      stoppedImmediately: false,
      passive: false,
      path,
    };
    dispatching.add(event);
    shadow(event, this, state);
    try {
      for (let i = path.length - 1; i > 0 && !state.stopped; --i)
        path[i]!.#invoke(event, state, CAPTURING_PHASE, true);
      // At the target, capturing listeners run before the others.
      if (!state.stopped) this.#invoke(event, state, AT_TARGET, true);
      if (!state.stopped) this.#invoke(event, state, AT_TARGET, false);
      if (event.bubbles) {
        for (let i = 1; i < path.length && !state.stopped; ++i)
          path[i]!.#invoke(event, state, BUBBLING_PHASE, false);
      }
    } finally {
      state.currentTarget = null;
      state.phase = NONE;
      state.path = [];
      dispatching.delete(event);
    }
    return !event.defaultPrevented;
  }

  /** The parent in an event path; none for a plain target. */
  [eventParent](): TreeEventTarget | null {
    return null;
  }

  #invoke(
    event: Event,
    state: DispatchState,
    phase: number,
    capture: boolean,
  ): void {
    const list = this.#listeners.get(event.type);
    if (list === undefined || list.length === 0) return;
    state.currentTarget = this;
    state.phase = phase;
    for (const entry of [...list]) {
      if (entry.removed) continue;
      // At the target both kinds run, capturing ones first (above).
      if (entry.capture !== capture) continue;
      if (entry.once)
        this.removeEventListener(event.type, entry.listener, entry);
      state.passive = entry.passive;
      try {
        if (typeof entry.listener === 'function')
          entry.listener.call(this, event);
        else entry.listener.handleEvent(event);
      } catch (error) {
        report(error);
      } finally {
        state.passive = false;
      }
      if (state.stoppedImmediately) break;
    }
  }
}

/** Points an event's dispatch properties at `state` (own properties win). */
function shadow(event: Event, target: TreeEventTarget, state: DispatchState) {
  const native = Event.prototype;
  Object.defineProperties(event, {
    target: { configurable: true, get: () => target },
    srcElement: { configurable: true, get: () => target },
    currentTarget: { configurable: true, get: () => state.currentTarget },
    eventPhase: { configurable: true, get: () => state.phase },
    composedPath: {
      configurable: true,
      value: () => (state.phase === NONE ? [] : [...state.path]),
    },
    stopPropagation: {
      configurable: true,
      value(this: Event) {
        state.stopped = true;
        native.stopPropagation.call(this);
      },
    },
    stopImmediatePropagation: {
      configurable: true,
      value(this: Event) {
        state.stopped = true;
        state.stoppedImmediately = true;
        native.stopImmediatePropagation.call(this);
      },
    },
    preventDefault: {
      configurable: true,
      value(this: Event) {
        if (!state.passive) native.preventDefault.call(this);
      },
    },
  });
}

/** Reports a listener's error like an uncaught one; the dispatch goes on. */
function report(error: unknown): void {
  if (typeof globalThis.reportError === 'function') reportError(error);
  else console.error(error);
}

// ── Event classes (soundor:ui's, with UiNode targets) ─────────────────────────

const SHIFT = 1;
const CONTROL = 2;
const ALT = 4;
const META = 8;

export interface ModifierEventInit extends EventInit {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

class ModifierEvent extends Event {
  readonly #modifiers: number;

  constructor(type: string, init: ModifierEventInit = {}) {
    super(type, init);
    this.#modifiers =
      (init.shiftKey ? SHIFT : 0) |
      (init.ctrlKey ? CONTROL : 0) |
      (init.altKey ? ALT : 0) |
      (init.metaKey ? META : 0);
  }

  get shiftKey(): boolean {
    return (this.#modifiers & SHIFT) !== 0;
  }
  get ctrlKey(): boolean {
    return (this.#modifiers & CONTROL) !== 0;
  }
  get altKey(): boolean {
    return (this.#modifiers & ALT) !== 0;
  }
  get metaKey(): boolean {
    return (this.#modifiers & META) !== 0;
  }

  getModifierState(key: string): boolean {
    switch (key) {
      case 'Shift':
        return this.shiftKey;
      case 'Control':
        return this.ctrlKey;
      case 'Alt':
        return this.altKey;
      case 'Meta':
        return this.metaKey;
      default:
        return false;
    }
  }
}

export interface PointerEventInit extends ModifierEventInit {
  clientX?: number;
  clientY?: number;
  offsetX?: number;
  offsetY?: number;
  button?: number;
  buttons?: number;
  pointerId?: number;
  pointerType?: 'mouse' | 'pen' | 'touch' | '';
  pressure?: number;
  isPrimary?: boolean;
  relatedTarget?: EventTarget | null;
}

type PointerData = Required<Omit<PointerEventInit, keyof ModifierEventInit>>;

export class PointerEvent extends ModifierEvent {
  readonly #init: PointerData;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.#init = {
      clientX: init.clientX ?? 0,
      clientY: init.clientY ?? 0,
      offsetX: init.offsetX ?? 0,
      offsetY: init.offsetY ?? 0,
      button: init.button ?? 0,
      buttons: init.buttons ?? 0,
      pointerId: init.pointerId ?? 0,
      pointerType: init.pointerType ?? '',
      pressure: init.pressure ?? 0,
      isPrimary: init.isPrimary ?? false,
      relatedTarget: init.relatedTarget ?? null,
    };
  }

  /** Relative to the view's top-left corner, in logical pixels. */
  get pageX(): number {
    return this.#init.clientX;
  }
  get pageY(): number {
    return this.#init.clientY;
  }
  /** Relative to the target's box, in logical pixels. */
  get locationX(): number {
    return this.#init.offsetX;
  }
  get locationY(): number {
    return this.#init.offsetY;
  }
  /** pageX and pageY, by their Web names. */
  get clientX(): number {
    return this.#init.clientX;
  }
  get clientY(): number {
    return this.#init.clientY;
  }
  get x(): number {
    return this.#init.clientX;
  }
  get y(): number {
    return this.#init.clientY;
  }
  /** locationX and locationY, by their Web names. */
  get offsetX(): number {
    return this.#init.offsetX;
  }
  get offsetY(): number {
    return this.#init.offsetY;
  }
  get button(): number {
    return this.#init.button;
  }
  get buttons(): number {
    return this.#init.buttons;
  }
  get pointerId(): number {
    return this.#init.pointerId;
  }
  get pointerType(): string {
    return this.#init.pointerType;
  }
  get pressure(): number {
    return this.#init.pressure;
  }
  get isPrimary(): boolean {
    return this.#init.isPrimary;
  }
  get relatedTarget(): EventTarget | null {
    return this.#init.relatedTarget;
  }
}

export interface WheelEventInit extends PointerEventInit {
  deltaX?: number;
  deltaY?: number;
  deltaMode?: 0 | 1 | 2;
}

export class WheelEvent extends PointerEvent {
  static readonly DOM_DELTA_PIXEL = 0;
  static readonly DOM_DELTA_LINE = 1;
  static readonly DOM_DELTA_PAGE = 2;

  readonly #deltaX: number;
  readonly #deltaY: number;
  readonly #deltaMode: 0 | 1 | 2;

  constructor(type: string, init: WheelEventInit = {}) {
    super(type, init);
    this.#deltaX = init.deltaX ?? 0;
    this.#deltaY = init.deltaY ?? 0;
    this.#deltaMode = init.deltaMode ?? 0;
  }

  get deltaX(): number {
    return this.#deltaX;
  }
  get deltaY(): number {
    return this.#deltaY;
  }
  get deltaZ(): number {
    return 0;
  }
  get deltaMode(): 0 | 1 | 2 {
    return this.#deltaMode;
  }
}

export interface KeyboardEventInit extends ModifierEventInit {
  key?: string;
  repeat?: boolean;
}

export class KeyboardEvent extends ModifierEvent {
  readonly #key: string;
  readonly #repeat: boolean;

  constructor(type: string, init: KeyboardEventInit = {}) {
    super(type, init);
    this.#key = init.key ?? '';
    this.#repeat = Boolean(init.repeat);
  }

  get key(): string {
    return this.#key;
  }
  get repeat(): boolean {
    return this.#repeat;
  }
}

export class FocusEvent extends Event {
  readonly #relatedTarget: EventTarget | null;

  constructor(
    type: string,
    init: EventInit & { relatedTarget?: EventTarget | null } = {},
  ) {
    super(type, init);
    this.#relatedTarget = init.relatedTarget ?? null;
  }

  get relatedTarget(): EventTarget | null {
    return this.#relatedTarget;
  }
}

export class InputEvent extends Event {
  readonly #data: string | null;
  readonly #inputType: string;

  constructor(
    type: string,
    init: EventInit & { data?: string | null; inputType?: string } = {},
  ) {
    super(type, init);
    this.#data = init.data ?? null;
    this.#inputType = init.inputType ?? '';
  }

  get data(): string | null {
    return this.#data;
  }
  get inputType(): string {
    return this.#inputType;
  }
}

/** An action assistive technology asks of a node (`accessibilityaction`). */
export class AccessibilityActionEvent extends Event {
  readonly #actionName: string;
  readonly #value: number | string | undefined;

  constructor(
    type: string,
    init: EventInit & { actionName?: string; value?: number | string } = {},
  ) {
    super(type, init);
    this.#actionName = String(init.actionName ?? '');
    this.#value = init.value;
  }

  /** 'activate', 'increment', 'setValue'... or a custom action's name. */
  get actionName(): string {
    return this.#actionName;
  }
  /** setValue: the value asked for (a number, or an input's text). */
  get value(): number | string | undefined {
    return this.#value;
  }
}
