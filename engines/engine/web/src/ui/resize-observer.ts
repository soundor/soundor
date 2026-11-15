// ResizeObserver for plugin code: the engine's, observing soundor:ui nodes,
// in place of the browser's, which observes DOM elements only.
//
// The browser still decides when: each node is observed through the
// browser's own ResizeObserver on its element, whose border box is the
// node's Yoga box, so notices come when a browser's do (after the frame's
// requestAnimationFrame callbacks and layout, before it paints, deeper in the
// tree for what a callback resized, with its loop error). What they say is
// measured from Yoga, as the engine does. A layout that changes only what
// the element's border box does not show (padding, the device pixel grid)
// observes that element again, which the browser answers on the same frame.
// DOM elements are passed to the browser's, so the host's own code is served
// as before.

import { UiNode, type ResizeBoxes } from './node';

type Box = 'content-box' | 'border-box' | 'device-pixel-content-box';
const BOXES: readonly Box[] = [
  'content-box',
  'border-box',
  'device-pixel-content-box',
];

type NativeObserver = globalThis.ResizeObserver;
type NativeConstructor = typeof globalThis.ResizeObserver;

const CONSTRUCTING = Symbol('constructing');

class ResizeObserverSize {
  readonly #inlineSize: number;
  readonly #blockSize: number;

  constructor(token: symbol, inlineSize: number, blockSize: number) {
    if (token !== CONSTRUCTING) throw new TypeError('Illegal constructor');
    this.#inlineSize = inlineSize;
    this.#blockSize = blockSize;
  }

  get inlineSize(): number {
    return this.#inlineSize;
  }

  get blockSize(): number {
    return this.#blockSize;
  }
}

const sizes = (width: number, height: number) =>
  Object.freeze([new ResizeObserverSize(CONSTRUCTING, width, height)]);

interface Measured {
  borderWidth: number;
  borderHeight: number;
  contentX: number;
  contentY: number;
  contentWidth: number;
  contentHeight: number;
  deviceWidth: number;
  deviceHeight: number;
}

const NO_BOXES: Measured = Object.freeze({
  borderWidth: 0,
  borderHeight: 0,
  contentX: 0,
  contentY: 0,
  contentWidth: 0,
  contentHeight: 0,
  deviceWidth: 0,
  deviceHeight: 0,
});

/** A node's boxes as laid out now; all 0 when it is not in the view. */
function measure(node: UiNode): Measured {
  const boxes: ResizeBoxes | null = UiNode.resizeBoxes(node);
  if (boxes === null) return NO_BOXES;
  return {
    ...boxes,
    // Layout puts edges on device pixels: whole numbers but for float error.
    deviceWidth: Math.round(boxes.contentWidth * boxes.scale),
    deviceHeight: Math.round(boxes.contentHeight * boxes.scale),
  };
}

function observedSize(boxes: Measured, box: Box): [number, number] {
  if (box === 'border-box') return [boxes.borderWidth, boxes.borderHeight];
  if (box === 'device-pixel-content-box')
    return [boxes.deviceWidth, boxes.deviceHeight];
  return [boxes.contentWidth, boxes.contentHeight];
}

class ResizeObserverEntry {
  readonly #target: UiNode;
  readonly #contentRect;
  readonly #contentBoxSize;
  readonly #borderBoxSize;
  readonly #devicePixelContentBoxSize;

  constructor(token: symbol, target: UiNode, boxes: Measured) {
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

  get target(): UiNode {
    return this.#target;
  }

  get contentRect() {
    return this.#contentRect;
  }

  get contentBoxSize() {
    return this.#contentBoxSize;
  }

  get borderBoxSize() {
    return this.#borderBoxSize;
  }

  get devicePixelContentBoxSize() {
    return this.#devicePixelContentBoxSize;
  }
}

interface Observation {
  box: Box;
  /** The observed box's size when last told: [inline, block]. */
  last: [number, number];
  /** The border box at the last look, which the browser compares itself. */
  border: [number, number];
  element: Element;
  stopLayout: () => void;
}

/** What a ResizeObserver calls: entries, and the observer. */
type Callback = (entries: ResizeObserverEntry[], observer: unknown) => void;

/** What plugin code's ResizeObserver is: the Web's, for nodes and elements. */
export interface NodeResizeObserver {
  observe(target: UiNode | Element, options?: { box?: Box }): void;
  unobserve(target: UiNode | Element): void;
  disconnect(): void;
}

/** Makes the ResizeObserver plugin code is given, over the browser's. */
export function createResizeObserver(
  Native: NativeConstructor,
): new (callback: Callback) => NodeResizeObserver {
  return class ResizeObserver implements NodeResizeObserver {
    readonly #callback: Callback;
    readonly #observations = new Map<UiNode, Observation>();
    readonly #byElement = new Map<Element, UiNode>();
    /** The browser's, waking this one for nodes' elements. */
    #nodes: NativeObserver | null = null;
    /** The browser's, for DOM elements, as they are. */
    #elements: NativeObserver | null = null;

    constructor(callback: Callback) {
      if (typeof callback !== 'function') {
        throw new TypeError(
          "Failed to construct 'ResizeObserver': parameter 1 is not a function",
        );
      }
      this.#callback = callback;
    }

    observe(target: UiNode | Element, options: { box?: Box } = {}): void {
      if (!(target instanceof UiNode)) {
        this.#elementObserver().observe(target as Element, options);
        return;
      }
      const box = options?.box ?? 'content-box';
      if (!BOXES.includes(box)) {
        throw new TypeError(
          `Failed to execute 'observe' on 'ResizeObserver': '${String(box)}' is not a valid box`,
        );
      }
      const existing = this.#observations.get(target);
      if (existing?.box === box) return;
      if (existing !== undefined) this.#forget(target, existing);
      const element = UiNode.elementOf(target) as Element;
      const boxes = measure(target);
      const observation: Observation = {
        box,
        last: [0, 0],
        border: [boxes.borderWidth, boxes.borderHeight],
        element,
        stopLayout: UiNode.viewOf(target).onLayout(() =>
          this.#laidOut(target, observation),
        ),
      };
      this.#observations.set(target, observation);
      this.#byElement.set(element, target);
      this.#nodeObserver().observe(element, { box: 'border-box' });
    }

    unobserve(target: UiNode | Element): void {
      if (!(target instanceof UiNode)) {
        this.#elements?.unobserve(target as Element);
        return;
      }
      const observation = this.#observations.get(target);
      if (observation !== undefined) this.#forget(target, observation);
    }

    disconnect(): void {
      for (const [target, observation] of [...this.#observations])
        this.#forget(target, observation);
      this.#elements?.disconnect();
    }

    #forget(target: UiNode, observation: Observation): void {
      observation.stopLayout();
      this.#observations.delete(target);
      this.#byElement.delete(observation.element);
      this.#nodes?.unobserve(observation.element);
    }

    #elementObserver(): NativeObserver {
      this.#elements ??= new Native((entries) =>
        this.#callback(entries as never, this),
      );
      return this.#elements;
    }

    #nodeObserver(): NativeObserver {
      this.#nodes ??= new Native((entries) => this.#woken(entries));
      return this.#nodes;
    }

    /**
     * After a layout: what changed that the browser cannot see in the border
     * box is observed again, so the browser tells it on this frame.
     */
    #laidOut(target: UiNode, observation: Observation): void {
      const boxes = measure(target);
      const border: [number, number] = [boxes.borderWidth, boxes.borderHeight];
      const [inline, block] = observedSize(boxes, observation.box);
      const borderSame =
        border[0] === observation.border[0] &&
        border[1] === observation.border[1];
      observation.border = border;
      if (
        borderSame &&
        border[0] + border[1] > 0 &&
        (inline !== observation.last[0] || block !== observation.last[1])
      ) {
        this.#nodes?.unobserve(observation.element);
        this.#nodes?.observe(observation.element, { box: 'border-box' });
      }
    }

    #woken(native: readonly globalThis.ResizeObserverEntry[]): void {
      const entries: ResizeObserverEntry[] = [];
      for (const { target: element } of native) {
        const target = this.#byElement.get(element);
        const observation =
          target === undefined ? undefined : this.#observations.get(target);
        if (target === undefined || observation === undefined) continue;
        const boxes = measure(target);
        observation.border = [boxes.borderWidth, boxes.borderHeight];
        const size = observedSize(boxes, observation.box);
        if (size[0] === observation.last[0] && size[1] === observation.last[1])
          continue;
        observation.last = size;
        entries.push(new ResizeObserverEntry(CONSTRUCTING, target, boxes));
      }
      if (entries.length > 0) this.#callback(entries, this);
    }
  };
}

/** Marks Soundor's, so that it is put in a scope once. */
const SOUNDOR = Symbol.for('soundor.ResizeObserver');

/**
 * Puts the ResizeObserver plugin code uses in `scope`, over the browser's,
 * once; the browser's goes on serving DOM elements. Its entries are this
 * module's, and the browser's ResizeObserverEntry stays the global, for the
 * entries of DOM elements.
 */
export function installResizeObserver(
  scope: typeof globalThis = globalThis,
): void {
  const Native = scope.ResizeObserver as
    | (NativeConstructor & { [SOUNDOR]?: true })
    | undefined;
  if (Native === undefined || Native[SOUNDOR]) return;
  const Observer = createResizeObserver(Native);
  Object.defineProperty(Observer, SOUNDOR, { value: true });
  Object.defineProperty(scope, 'ResizeObserver', {
    value: Observer,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

export { ResizeObserverEntry, ResizeObserverSize };
