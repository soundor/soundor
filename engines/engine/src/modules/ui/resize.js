// ResizeObserver, as on the Web, observing soundor:ui nodes: after a frame's
// requestAnimationFrame callbacks and its layout, before it is drawn, each
// observer is told of the nodes it observes whose box changed size since it
// was last told. As in browsers, the first notice comes once a node is laid
// out to more than 0×0, and the nodes a callback resizes are measured again
// in the same frame, deeper in the tree each time; what is left is reported
// as an error and told on the next frame. Installed with soundor:ui.
//
// A frame is cheap when nothing can have changed size: one native call
// compares the surface's revision, and no node is measured.

import * as native from 'soundor:internal/ui';
import { reportError } from 'soundor:internal/web/console';

/** Set by soundor:ui: a node's id and depth (ancestors + 1), or null. */
let resolveNode = () => null;

export function setNodeResolver(resolve) {
  resolveNode = resolve;
}

const CONSTRUCTING = Symbol('constructing');
const BOXES = ['content-box', 'border-box', 'device-pixel-content-box'];

/** Observers observing at least one node. */
const active = new Set();
/** The surface's revision when the sizes were last compared. */
let measuredRevision = -1;
/** A node was observed, or a notice put off: compare on the next frame anyway. */
let compareAnyway = false;

class ResizeObserverSize {
  #inlineSize;
  #blockSize;

  constructor(token, inlineSize, blockSize) {
    if (token !== CONSTRUCTING) throw new TypeError('Illegal constructor');
    this.#inlineSize = inlineSize;
    this.#blockSize = blockSize;
  }

  get inlineSize() {
    return this.#inlineSize;
  }

  get blockSize() {
    return this.#blockSize;
  }
}

/** A box's size, as the one-element frozen list a ResizeObserverEntry has. */
const sizes = (width, height) =>
  Object.freeze([new ResizeObserverSize(CONSTRUCTING, width, height)]);

class ResizeObserverEntry {
  #target;
  #contentRect;
  #contentBoxSize;
  #borderBoxSize;
  #devicePixelContentBoxSize;

  constructor(token, target, boxes) {
    if (token !== CONSTRUCTING) throw new TypeError('Illegal constructor');
    this.#target = target;
    const { contentX: x, contentY: y, contentWidth, contentHeight } = boxes;
    this.#contentRect = Object.freeze({
      x,
      y,
      width: contentWidth,
      height: contentHeight,
      top: y,
      left: x,
      right: x + contentWidth,
      bottom: y + contentHeight,
    });
    this.#contentBoxSize = sizes(contentWidth, contentHeight);
    this.#borderBoxSize = sizes(boxes.borderWidth, boxes.borderHeight);
    this.#devicePixelContentBoxSize = sizes(
      boxes.deviceWidth,
      boxes.deviceHeight,
    );
  }

  get target() {
    return this.#target;
  }

  /** The content box: x and y are where it starts, inside the padding. */
  get contentRect() {
    return this.#contentRect;
  }

  get contentBoxSize() {
    return this.#contentBoxSize;
  }

  get borderBoxSize() {
    return this.#borderBoxSize;
  }

  /** The content box in device pixels: a canvas's drawing buffer, exactly. */
  get devicePixelContentBoxSize() {
    return this.#devicePixelContentBoxSize;
  }
}

const NO_BOXES = Object.freeze({
  borderWidth: 0,
  borderHeight: 0,
  contentX: 0,
  contentY: 0,
  contentWidth: 0,
  contentHeight: 0,
  deviceWidth: 0,
  deviceHeight: 0,
});

/** A node's boxes as laid out now; all 0 when it is not in the tree. */
function measure(id) {
  const boxes = native.resizeBoxes(id);
  if (boxes === null) return NO_BOXES;
  const [borderWidth, borderHeight, contentX, contentY, width, height] = boxes;
  const scale = native.size().scale;
  return {
    borderWidth,
    borderHeight,
    contentX,
    contentY,
    contentWidth: width,
    contentHeight: height,
    // Layout puts edges on device pixels, so these are whole numbers but
    // for float error.
    deviceWidth: Math.round(width * scale),
    deviceHeight: Math.round(height * scale),
  };
}

/** The size an observation compares: of the box it observes. */
function observedSize(boxes, box) {
  if (box === 'border-box') return [boxes.borderWidth, boxes.borderHeight];
  if (box === 'device-pixel-content-box')
    return [boxes.deviceWidth, boxes.deviceHeight];
  return [boxes.contentWidth, boxes.contentHeight];
}

class ResizeObserver {
  #callback;
  /**
   * Node id → { target, box, last: [inline, block] }, in the order observed.
   * Nodes are held weakly: as in browsers, an observer goes with the nodes
   * it observes once nothing else holds them (the tree holds its nodes).
   */
  #observations = new Map();
  /** What the current gathering found to tell. */
  #pending = [];

  constructor(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError(
        "Failed to construct 'ResizeObserver': parameter 1 is not a function",
      );
    }
    this.#callback = callback;
  }

  observe(target, options = {}) {
    const node = resolveNode(target);
    if (node === null) {
      throw new TypeError(
        "Failed to execute 'observe' on 'ResizeObserver': parameter 1 is not a UiNode",
      );
    }
    const box = options?.box ?? 'content-box';
    if (!BOXES.includes(box)) {
      throw new TypeError(
        `Failed to execute 'observe' on 'ResizeObserver': '${String(box)}' is not a valid box`,
      );
    }
    // Observing again with the same box changes nothing; another starts over.
    const existing = this.#observations.get(node.id);
    if (existing?.target.deref() === target && existing.box === box) return;
    this.#observations.delete(node.id);
    this.#observations.set(node.id, {
      target: new WeakRef(target),
      box,
      last: [0, 0],
    });
    active.add(this);
    compareAnyway = true;
  }

  unobserve(target) {
    const node = resolveNode(target);
    if (node === null) {
      throw new TypeError(
        "Failed to execute 'unobserve' on 'ResizeObserver': parameter 1 is not a UiNode",
      );
    }
    if (this.#observations.get(node.id)?.target.deref() === target)
      this.#observations.delete(node.id);
    if (this.#observations.size === 0) active.delete(this);
  }

  disconnect() {
    this.#observations.clear();
    this.#pending = [];
    active.delete(this);
  }

  /**
   * Finds what this observer has to tell at depths deeper than `depth`;
   * returns whether it put off any, shallower, until the next frame.
   */
  static gather(observer, depth) {
    observer.#pending = [];
    let skipped = false;
    for (const [id, observation] of observer.#observations) {
      const target = observation.target.deref();
      const node = target === undefined ? null : resolveNode(target);
      if (node === null || node.id !== id) {
        // Collected: there is nothing left to observe.
        observer.#observations.delete(id);
        continue;
      }
      const boxes = measure(id);
      const [inline, block] = observedSize(boxes, observation.box);
      if (inline === observation.last[0] && block === observation.last[1])
        continue;
      if (node.depth > depth)
        observer.#pending.push({
          target,
          observation,
          depth: node.depth,
          boxes,
        });
      else skipped = true;
    }
    if (observer.#observations.size === 0) active.delete(observer);
    return skipped;
  }

  /** Tells this observer what it gathered; returns the shallowest depth. */
  static broadcast(observer) {
    const pending = observer.#pending;
    observer.#pending = [];
    if (pending.length === 0) return Infinity;
    let shallowest = Infinity;
    const entries = pending.map(({ target, observation, depth, boxes }) => {
      observation.last = observedSize(boxes, observation.box);
      shallowest = Math.min(shallowest, depth);
      return new ResizeObserverEntry(CONSTRUCTING, target, boxes);
    });
    try {
      observer.#callback.call(observer, entries, observer);
    } catch (error) {
      reportError(error);
    }
    return shallowest;
  }
}

/**
 * Tells observers what changed size: the frame listener calls it every
 * frame, after the frame's requestAnimationFrame callbacks.
 */
export function deliverResizes() {
  if (active.size === 0) return;
  if (native.revision() === measuredRevision && !compareAnyway) return;
  compareAnyway = false;
  // As the Web's: gather what changed deeper than the last broadcast went,
  // tell it, and again, until nothing is left that deep.
  let depth = 0;
  let skipped;
  for (;;) {
    skipped = false;
    const observers = [...active];
    for (const observer of observers)
      if (ResizeObserver.gather(observer, depth)) skipped = true;
    let shallowest = Infinity;
    for (const observer of observers)
      shallowest = Math.min(shallowest, ResizeObserver.broadcast(observer));
    if (shallowest === Infinity) break;
    depth = shallowest;
  }
  // The last gathering came after every callback: the sizes are current.
  measuredRevision = native.revision();
  if (skipped) {
    compareAnyway = true;
    reportError(
      new Error(
        'ResizeObserver loop completed with undelivered notifications.',
      ),
    );
  }
}

for (const [name, value] of Object.entries({
  ResizeObserver,
  ResizeObserverEntry,
  ResizeObserverSize,
})) {
  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}
