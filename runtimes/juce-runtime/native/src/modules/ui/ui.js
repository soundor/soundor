// `soundor:ui` — the plugin view's node tree, its layout and its input.
//
// Embedded into the native runtime at build time. The native side
// (`soundor:internal/ui`) owns the tree, lays it out with Yoga and routes the
// view's input; this layer gives plugin code DOM-like nodes: EventTargets
// whose events capture and bubble along the tree, with Web event classes.
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

  /** Nodes are made with createView() and createText(). */
  constructor(token, type, id) {
    if (token !== CONSTRUCTING) {
      throw new TypeError(
        'Illegal constructor: use createView() or createText()',
      );
    }
    super();
    this.#type = type;
    this.#id = id;
    nodes.set(id, new WeakRef(this));
  }

  /** 'view' or 'text'. */
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

  /** The text of a text node. */
  get text() {
    return this.#text;
  }

  set text(value) {
    if (this.#type !== 'text') {
      throw new TypeError('only text nodes have text');
    }
    const text = String(value);
    native.setText(this.#id, text);
    this.#text = text;
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
    internals = { id: (node) => node.#id };
  }
}

function create(text) {
  const node = new UiNode(
    CONSTRUCTING,
    text ? 'text' : 'view',
    native.createNode(text),
  );
  released.register(node, internals.id(node));
  return node;
}

/** A new, detached view: a box laid out with flexbox. */
export function createView(style) {
  const node = create(false);
  if (style !== undefined) node.style = style;
  return node;
}

/** A new, detached text node. */
export function createText(text = '', style) {
  const node = create(true);
  if (text !== '') node.text = text;
  if (style !== undefined) node.style = style;
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
];

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
  return event.defaultPrevented;
});
