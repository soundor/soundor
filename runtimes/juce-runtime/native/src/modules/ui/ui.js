// `soundor:ui` — the plugin view's node tree, its layout and its input.
//
// Embedded into the native runtime at build time. The native side
// (`soundor:internal/ui`) owns the tree, lays it out with Yoga and routes the
// view's input; this layer gives plugin code DOM-like nodes: EventTargets
// whose events capture and bubble along the tree, with Web event classes.
//
// Nodes are views (flexbox boxes), text, images, scroll views and text
// inputs; the native renderer (Skia) draws them. Text inputs edit themselves
// as the default action of the key, text and pointer events they receive.
//
// A node lives as long as JavaScript can reach it. The root is always
// reachable, and so is everything attached to it; a detached node nobody
// references is released, natively too, when it is garbage collected.

import * as native from 'soundor:internal/ui';
import {
  Event,
  EventTarget,
  eventParent,
  trustEvent,
} from 'soundor:internal/web/events';

const CONSTRUCTING = Symbol('constructing');
/** The native node types, by name. */
const TYPES = ['view', 'text', 'image', 'scroll', 'input'];

/** id → WeakRef<UiNode>, to find event targets. */
const nodes = new Map();
const released = new FinalizationRegistry((id) => {
  nodes.delete(id);
  native.releaseNode(id);
});

let internals;

function describe(value) {
  if (value === null) return 'null';
  if (typeof value === 'object') return value.constructor?.name ?? 'object';
  return typeof value;
}

function expectNode(value, what) {
  if (!(value instanceof UiNode)) {
    throw new TypeError(`${what} must be a UiNode, got ${describe(value)}`);
  }
  return value;
}

export class UiNode extends EventTarget {
  #id;
  #type;
  #parent = null;
  #children = [];
  #style = Object.freeze({});
  #text = '';
  #focusable = false;
  #source = '';
  #placeholder = '';

  /** Nodes are made with createView(), createText() and the like. */
  constructor(token, type, id) {
    if (token !== CONSTRUCTING) {
      throw new TypeError(
        'Illegal constructor: use createView(), createText() and the like',
      );
    }
    super();
    this.#type = type;
    this.#id = id;
    nodes.set(id, new WeakRef(this));
  }

  /** 'view', 'text', 'image', 'scroll' or 'input'. */
  get type() {
    return this.#type;
  }

  get parent() {
    return this.#parent;
  }

  /** A snapshot of the children, in order. */
  get children() {
    return Object.freeze([...this.#children]);
  }

  get firstChild() {
    return this.#children[0] ?? null;
  }

  get lastChild() {
    return this.#children.at(-1) ?? null;
  }

  get nextSibling() {
    const siblings = this.#parent?.#children;
    return siblings?.[siblings.indexOf(this) + 1] ?? null;
  }

  get previousSibling() {
    const siblings = this.#parent?.#children;
    return siblings?.[siblings.indexOf(this) - 1] ?? null;
  }

  /** Whether the node is in the view's tree. */
  get isConnected() {
    let node = this;
    while (node.#parent !== null) node = node.#parent;
    return node === root;
  }

  /** The style last set; assigning replaces it as a whole. */
  get style() {
    return this.#style;
  }

  set style(value) {
    const style = value ?? {};
    if (typeof style !== 'object') {
      throw new TypeError(`style must be an object, got ${describe(value)}`);
    }
    native.setStyle(this.#id, style);
    this.#style = Object.freeze({ ...style });
  }

  /** The text of a text node, or the value of an input. */
  get text() {
    return this.#text;
  }

  set text(value) {
    if (this.#type !== 'text' && this.#type !== 'input') {
      throw new TypeError('only text and input nodes have text');
    }
    const text = String(value);
    native.setText(this.#id, text);
    this.#text = text;
  }

  /** An input's text. */
  get value() {
    this.#expect('input', 'value');
    return this.#text;
  }

  set value(value) {
    this.#expect('input', 'value');
    this.text = value;
    // Like the DOM: setting the value puts the caret at its end.
    this.setSelectionRange(this.#text.length, this.#text.length);
  }

  /** An input's hint, shown while it is empty. */
  get placeholder() {
    this.#expect('input', 'placeholder');
    return this.#placeholder;
  }

  set placeholder(value) {
    this.#expect('input', 'placeholder');
    this.#placeholder = String(value);
    native.setPlaceholder(this.#id, this.#placeholder);
  }

  get selectionStart() {
    this.#expect('input', 'selectionStart');
    const { anchor, focus } = native.selection(this.#id);
    return Math.min(anchor, focus);
  }

  get selectionEnd() {
    this.#expect('input', 'selectionEnd');
    const { anchor, focus } = native.selection(this.#id);
    return Math.max(anchor, focus);
  }

  get selectionDirection() {
    this.#expect('input', 'selectionDirection');
    const { anchor, focus } = native.selection(this.#id);
    return focus < anchor ? 'backward' : 'forward';
  }

  /** Selects [start, end) of an input's text (UTF-16 indices). */
  setSelectionRange(start, end, direction = 'forward') {
    this.#expect('input', 'setSelectionRange()');
    const from = Math.max(0, Math.min(Number(start) || 0, this.#text.length));
    const to = Math.max(from, Math.min(Number(end) || 0, this.#text.length));
    if (direction === 'backward') native.setSelection(this.#id, to, from);
    else native.setSelection(this.#id, from, to);
  }

  select() {
    this.setSelectionRange(0, this.#text.length);
  }

  /** An image's asset id (what `import logo from './logo.png'` yields). */
  get source() {
    this.#expect('image', 'source');
    return this.#source;
  }

  set source(value) {
    this.#expect('image', 'source');
    this.#source = value === null || value === undefined ? '' : String(value);
    native.setSource(this.#id, this.#source);
  }

  /** How far a scroll view's content is scrolled. */
  get scrollTop() {
    return native.scrollOffset(this.#id).y;
  }

  set scrollTop(value) {
    this.scrollTo({ top: value });
  }

  get scrollLeft() {
    return native.scrollOffset(this.#id).x;
  }

  set scrollLeft(value) {
    this.scrollTo({ left: value });
  }

  /** The size of what a scroll view scrolls. */
  get scrollWidth() {
    return native.contentSize(this.#id).width;
  }

  get scrollHeight() {
    return native.contentSize(this.#id).height;
  }

  /** scrollTo({ top, left }) or scrollTo(left, top); clamped to the content. */
  scrollTo(optionsOrLeft, top) {
    this.#expect('scroll', 'scrollTo()');
    const current = native.scrollOffset(this.#id);
    const target =
      typeof optionsOrLeft === 'object' && optionsOrLeft !== null
        ? {
            x: optionsOrLeft.left ?? current.x,
            y: optionsOrLeft.top ?? current.y,
          }
        : { x: optionsOrLeft ?? current.x, y: top ?? current.y };
    native.scrollTo(this.#id, Number(target.x) || 0, Number(target.y) || 0);
  }

  scrollBy(optionsOrLeft, top) {
    const current = native.scrollOffset(this.#id);
    const delta =
      typeof optionsOrLeft === 'object' && optionsOrLeft !== null
        ? { x: optionsOrLeft.left ?? 0, y: optionsOrLeft.top ?? 0 }
        : { x: optionsOrLeft ?? 0, y: top ?? 0 };
    this.scrollTo(current.x + Number(delta.x), current.y + Number(delta.y));
  }

  #expect(type, what) {
    if (this.#type !== type) {
      throw new TypeError(`${what} belongs to ${type} nodes`);
    }
  }

  /** Whether the node takes focus when pressed or tabbed to. */
  get focusable() {
    return this.#focusable;
  }

  set focusable(value) {
    this.#focusable = Boolean(value);
    native.setFocusable(this.#id, this.#focusable);
  }

  get focused() {
    return native.focused() === this.#id;
  }

  focus() {
    native.focus(this.#id);
  }

  blur() {
    if (this.focused) native.focus(0);
  }

  appendChild(child) {
    return this.insertBefore(child, null);
  }

  insertBefore(child, before) {
    expectNode(child, 'child');
    if (before !== null && before !== undefined) expectNode(before, 'before');
    native.insertChild(this.#id, child.#id, before?.#id ?? 0);
    if (child === before) return child;
    if (child.#parent !== null) {
      const siblings = child.#parent.#children;
      siblings.splice(siblings.indexOf(child), 1);
    }
    const index = before ? this.#children.indexOf(before) : -1;
    if (index < 0) this.#children.push(child);
    else this.#children.splice(index, 0, child);
    child.#parent = this;
    return child;
  }

  removeChild(child) {
    expectNode(child, 'child');
    native.removeChild(this.#id, child.#id);
    this.#children.splice(this.#children.indexOf(child), 1);
    child.#parent = null;
    return child;
  }

  /** Removes the node from its parent, if it has one. */
  remove() {
    this.#parent?.removeChild(this);
  }

  contains(other) {
    for (let node = other; node; node = node.#parent) {
      if (node === this) return true;
    }
    return false;
  }

  /** The laid-out box relative to the parent's. */
  get layout() {
    return native.frame(this.#id);
  }

  /** The laid-out box relative to the view (zero when not connected). */
  getBoundingClientRect() {
    return native.bounds(this.#id);
  }

  [eventParent]() {
    return this.#parent;
  }

  static {
    internals = {
      id: (node) => node.#id,
      setFocusableState(node, value) {
        node.#focusable = value;
      },
    };
  }
}

function create(type) {
  const node = new UiNode(
    CONSTRUCTING,
    type,
    native.createNode(TYPES.indexOf(type)),
  );
  released.register(node, internals.id(node));
  return node;
}

/** A new, detached view: a box laid out with flexbox. */
export function createView(style) {
  const node = create('view');
  if (style !== undefined) node.style = style;
  return node;
}

/** A new, detached text node. */
export function createText(text = '', style) {
  const node = create('text');
  if (text !== '') node.text = text;
  if (style !== undefined) node.style = style;
  return node;
}

/** A new, detached image showing a bundled asset. */
export function createImage(source = '', style) {
  const node = create('image');
  if (source !== '') node.source = source;
  if (style !== undefined) node.style = style;
  return node;
}

/** A new, detached view whose children scroll (by wheel, or scrollTo()). */
export function createScrollView(style) {
  const node = create('scroll');
  if (style !== undefined) node.style = style;
  return node;
}

/** A new, detached single-line text input. It is focusable. */
export function createTextInput(options = {}) {
  const node = create('input');
  internals.setFocusableState(node, true);
  if (options.value !== undefined) node.value = options.value;
  if (options.placeholder !== undefined) node.placeholder = options.placeholder;
  if (options.style !== undefined) node.style = options.style;
  return node;
}

/** The view's root node; it always fills the view. */
export const root = new UiNode(CONSTRUCTING, 'view', native.rootId);

/** The view's size in logical pixels, and device pixels per logical pixel. */
export function viewSize() {
  return native.size();
}

/** The node that has keyboard focus, if any. */
export function focusedNode() {
  return nodes.get(native.focused())?.deref() ?? null;
}

/** The system clipboard's text (navigator.clipboard's shape). */
export const clipboard = Object.freeze({
  readText: async () => native.readClipboard(),
  writeText: async (text) => native.writeClipboard(String(text)),
});

/**
 * Makes `node` pressable: press with the primary button (released over it)
 * or, when focused, with Enter or Space. Reports the pressed and hovered
 * state as it changes. Returns a function that undoes it.
 */
export function pressable(node, handlers = {}) {
  expectNode(node, 'node');
  const state = { pressed: false, hovered: false };
  const update = (change) => {
    const next = { ...state, ...change };
    if (next.pressed === state.pressed && next.hovered === state.hovered)
      return;
    Object.assign(state, next);
    handlers.onStateChange?.({ ...state });
  };
  const controller = new AbortController();
  const { signal } = controller;
  const on = (type, listener) =>
    node.addEventListener(type, listener, { signal });

  on('pointerdown', (event) => {
    if (event.button !== 0) return;
    update({ pressed: true });
    handlers.onPressIn?.(event);
  });
  on('pointerup', (event) => {
    if (!state.pressed) return;
    update({ pressed: false });
    handlers.onPressOut?.(event);
  });
  on('pointercancel', (event) => {
    if (!state.pressed) return;
    update({ pressed: false });
    handlers.onPressOut?.(event);
  });
  on('click', (event) => handlers.onPress?.(event));
  on('pointerenter', (event) => {
    update({ hovered: true });
    handlers.onHoverIn?.(event);
  });
  on('pointerleave', (event) => {
    update({ hovered: false });
    handlers.onHoverOut?.(event);
  });
  on('keydown', (event) => {
    if (event.target !== node || event.repeat) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handlers.onPress?.(event);
  });
  node.focusable = true;
  return () => controller.abort();
}

// ── Events ───────────────────────────────────────────────────────────────────

const SHIFT = 1;
const CONTROL = 2;
const ALT = 4;
const META = 8;

class ModifierEvent extends Event {
  #modifiers;

  constructor(type, init = {}) {
    super(type, init);
    this.#modifiers =
      (init.shiftKey ? SHIFT : 0) |
      (init.ctrlKey ? CONTROL : 0) |
      (init.altKey ? ALT : 0) |
      (init.metaKey ? META : 0);
  }

  get shiftKey() {
    return (this.#modifiers & SHIFT) !== 0;
  }
  get ctrlKey() {
    return (this.#modifiers & CONTROL) !== 0;
  }
  get altKey() {
    return (this.#modifiers & ALT) !== 0;
  }
  get metaKey() {
    return (this.#modifiers & META) !== 0;
  }

  getModifierState(key) {
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

export class PointerEvent extends ModifierEvent {
  #init;

  constructor(type, init = {}) {
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

  /** Relative to the view. */
  get clientX() {
    return this.#init.clientX;
  }
  get clientY() {
    return this.#init.clientY;
  }
  get x() {
    return this.#init.clientX;
  }
  get y() {
    return this.#init.clientY;
  }
  /** Relative to the target. */
  get offsetX() {
    return this.#init.offsetX;
  }
  get offsetY() {
    return this.#init.offsetY;
  }
  get button() {
    return this.#init.button;
  }
  get buttons() {
    return this.#init.buttons;
  }
  get pointerId() {
    return this.#init.pointerId;
  }
  get pointerType() {
    return this.#init.pointerType;
  }
  get pressure() {
    return this.#init.pressure;
  }
  get isPrimary() {
    return this.#init.isPrimary;
  }
  get relatedTarget() {
    return this.#init.relatedTarget;
  }
}

export class WheelEvent extends PointerEvent {
  #deltaX;
  #deltaY;
  #deltaMode;

  constructor(type, init = {}) {
    super(type, init);
    this.#deltaX = init.deltaX ?? 0;
    this.#deltaY = init.deltaY ?? 0;
    this.#deltaMode = init.deltaMode ?? 0;
  }

  get deltaX() {
    return this.#deltaX;
  }
  get deltaY() {
    return this.#deltaY;
  }
  get deltaZ() {
    return 0;
  }
  /** 0: pixels, 1: lines. */
  get deltaMode() {
    return this.#deltaMode;
  }
}
WheelEvent.DOM_DELTA_PIXEL = 0;
WheelEvent.DOM_DELTA_LINE = 1;
WheelEvent.DOM_DELTA_PAGE = 2;

export class KeyboardEvent extends ModifierEvent {
  #key;
  #repeat;

  constructor(type, init = {}) {
    super(type, init);
    this.#key = init.key ?? '';
    this.#repeat = Boolean(init.repeat);
  }

  get key() {
    return this.#key;
  }
  get repeat() {
    return this.#repeat;
  }
}

export class FocusEvent extends Event {
  #relatedTarget;

  constructor(type, init = {}) {
    super(type, init);
    this.#relatedTarget = init.relatedTarget ?? null;
  }

  get relatedTarget() {
    return this.#relatedTarget;
  }
}

export class InputEvent extends Event {
  #data;
  #inputType;

  constructor(type, init = {}) {
    super(type, init);
    this.#data = init.data ?? null;
    this.#inputType = init.inputType ?? '';
  }

  get data() {
    return this.#data;
  }
  get inputType() {
    return this.#inputType;
  }
}

/** By the native event type: [name, class, bubbles, cancelable]. */
const EVENT_TYPES = [
  ['pointerdown', PointerEvent, true, true],
  ['pointermove', PointerEvent, true, true],
  ['pointerup', PointerEvent, true, true],
  ['pointercancel', PointerEvent, true, false],
  ['pointerenter', PointerEvent, false, false],
  ['pointerleave', PointerEvent, false, false],
  ['click', PointerEvent, true, true],
  ['wheel', WheelEvent, true, true],
  ['keydown', KeyboardEvent, true, true],
  ['keyup', KeyboardEvent, true, true],
  ['beforeinput', InputEvent, true, true],
  ['focus', FocusEvent, false, false],
  ['blur', FocusEvent, false, false],
  ['scroll', Event, false, false],
];

// ── Text editing: the default actions of an input's events ─────────────────

/** Where the value was when the input last reported a change. */
const committed = new WeakMap();

const isLowSurrogate = (code) => code >= 0xdc00 && code <= 0xdfff;

/** The code point boundary before `i`. */
function previousIndex(text, i) {
  if (i <= 0) return 0;
  return i >= 2 && isLowSurrogate(text.charCodeAt(i - 1)) ? i - 2 : i - 1;
}

/** The code point boundary after `i`. */
function nextIndex(text, i) {
  if (i >= text.length) return text.length;
  return isLowSurrogate(text.charCodeAt(i + 1)) ? i + 2 : i + 1;
}

/** Where a word-wise move from `from` lands: back (step -1) or forward. */
function wordBoundary(text, from, step) {
  let i = from;
  if (step < 0) {
    while (i > 0 && /\s/.test(text[i - 1])) i--;
    while (i > 0 && /\S/.test(text[i - 1])) i--;
  } else {
    while (i < text.length && /\s/.test(text[i])) i++;
    while (i < text.length && /\S/.test(text[i])) i++;
  }
  return i;
}

function edit(input, text, caret, inputType, data = null) {
  input.text = text;
  input.setSelectionRange(caret, caret);
  input.dispatchEvent(
    trustEvent(new InputEvent('input', { bubbles: true, inputType, data })),
  );
}

function commit(input) {
  if (committed.get(input) === input.value) return;
  committed.set(input, input.value);
  input.dispatchEvent(trustEvent(new Event('change', { bubbles: true })));
}

function replaceSelection(input, data, inputType) {
  const text = input.value;
  const start = input.selectionStart;
  edit(
    input,
    text.slice(0, start) + data + text.slice(input.selectionEnd),
    start + data.length,
    inputType,
    data,
  );
}

/** keydown on a focused input; returns whether it did something. */
function editKey(input, event) {
  const text = input.value;
  const { selectionStart: start, selectionEnd: end } = input;
  const selection = native.selection(internals.id(input));
  const command = event.ctrlKey || event.metaKey;
  const byWord = event.ctrlKey || event.altKey;
  const move = (to) => {
    const target = Math.max(0, Math.min(to, text.length));
    if (event.shiftKey)
      native.setSelection(internals.id(input), selection.anchor, target);
    else input.setSelectionRange(target, target);
    return true;
  };
  switch (event.key) {
    case 'ArrowLeft':
      if (event.metaKey) return move(0);
      if (!event.shiftKey && start !== end) return move(start);
      return move(
        byWord
          ? wordBoundary(text, selection.focus, -1)
          : previousIndex(text, selection.focus),
      );
    case 'ArrowRight':
      if (event.metaKey) return move(text.length);
      if (!event.shiftKey && start !== end) return move(end);
      return move(
        byWord
          ? wordBoundary(text, selection.focus, 1)
          : nextIndex(text, selection.focus),
      );
    case 'Home':
    case 'ArrowUp':
      return move(0);
    case 'End':
    case 'ArrowDown':
      return move(text.length);
    case 'Backspace':
      if (start !== end) replaceSelection(input, '', 'deleteContentBackward');
      else if (start > 0) {
        const from = byWord
          ? wordBoundary(text, start, -1)
          : previousIndex(text, start);
        edit(
          input,
          text.slice(0, from) + text.slice(start),
          from,
          'deleteContentBackward',
        );
      }
      return true;
    case 'Delete':
      if (start !== end) replaceSelection(input, '', 'deleteContentForward');
      else if (start < text.length) {
        const to = byWord
          ? wordBoundary(text, start, 1)
          : nextIndex(text, start);
        edit(
          input,
          text.slice(0, start) + text.slice(to),
          start,
          'deleteContentForward',
        );
      }
      return true;
    case 'Enter':
      commit(input);
      return true;
    case 'Escape':
      return false;
  }
  if (command && !event.altKey) {
    switch (event.key.toLowerCase()) {
      case 'a':
        input.select();
        return true;
      case 'c':
        if (start !== end) native.writeClipboard(text.slice(start, end));
        return true;
      case 'x':
        if (start !== end) {
          native.writeClipboard(text.slice(start, end));
          replaceSelection(input, '', 'deleteByCut');
        }
        return true;
      case 'v': {
        const pasted = native.readClipboard().replace(/[\r\n]+/g, ' ');
        if (pasted !== '') replaceSelection(input, pasted, 'insertFromPaste');
        return true;
      }
    }
  }
  // Characters arrive as text (beforeinput) next.
  return false;
}

/** Runs the default action of a dispatched event; returns whether it did. */
function defaultAction(target, event) {
  if (target.type !== 'input') return false;
  const id = internals.id(target);
  switch (event.type) {
    case 'keydown':
      return editKey(target, event);
    case 'beforeinput':
      replaceSelection(target, event.data ?? '', 'insertText');
      return true;
    // Placing the caret is not "handling" the press: the input still takes
    // focus from it.
    case 'pointerdown': {
      if (event.button !== 0) return false;
      const offset = native.offsetAt(id, event.offsetX, event.offsetY);
      if (event.shiftKey)
        native.setSelection(id, native.selection(id).anchor, offset);
      else native.setSelection(id, offset, offset);
      return false;
    }
    case 'pointermove':
      if ((event.buttons & 1) !== 0)
        native.setSelection(
          id,
          native.selection(id).anchor,
          native.offsetAt(id, event.offsetX, event.offsetY),
        );
      return false;
    case 'focus':
      if (!committed.has(target)) committed.set(target, target.value);
      return false;
    case 'blur':
      commit(target);
      return false;
  }
  return false;
}

const nodeById = (id) => (id === 0 ? null : (nodes.get(id)?.deref() ?? null));

native.setListener((type, targetId, data) => {
  const target = nodeById(targetId);
  const kind = EVENT_TYPES[type];
  if (target === null || kind === undefined) return false;
  const [name, EventClass, bubbles, cancelable] = kind;
  const event = new EventClass(name, {
    bubbles,
    cancelable,
    composed: true,
    shiftKey: (data.modifiers & SHIFT) !== 0,
    ctrlKey: (data.modifiers & CONTROL) !== 0,
    altKey: (data.modifiers & ALT) !== 0,
    metaKey: (data.modifiers & META) !== 0,
    clientX: data.x,
    clientY: data.y,
    offsetX: data.offsetX,
    offsetY: data.offsetY,
    button: data.button,
    buttons: data.buttons,
    pointerId: data.pointerId,
    pointerType: data.pointerType,
    pressure: data.pressure,
    isPrimary: true,
    deltaX: data.deltaX,
    deltaY: data.deltaY,
    deltaMode: data.deltaMode,
    key: data.key,
    repeat: data.repeat,
    data: data.data,
    inputType: 'insertText',
    relatedTarget: nodeById(data.related),
  });
  trustEvent(event);
  target.dispatchEvent(event);
  if (event.defaultPrevented) return true;
  return defaultAction(target, event);
});
