/**
 * `UiNode`: a node of the plugin view, drawn by one DOM element. Plugin code
 * only ever sees UiNodes; the element is this module's business. The tree,
 * its rules and errors follow the native runtime (`soundor:ui` there). The
 * engine's C++ core holds the same tree: it reads the styles and lays the
 * tree out (Yoga, and its text engine), and the view hands each node what
 * changed (`UiNode.placed()` and the like); the element is placed there.
 */

import type { EngineCore, Extent, Frame, TextLines } from '../core.ts';
import type { Baselines } from '../text.ts';
import {
  freezeAccessibility,
  normalizeAccessibility,
  type NormalizedAccessibility,
} from './accessibility.ts';
import type { AnimationController } from './animation.ts';
import { standardEase } from './animation.ts';
import {
  computedTransform,
  IDENTITY,
  inversePoint,
  multiply,
  translation,
  type Matrix,
} from './coordinates.ts';
import { eventParent, TreeEventTarget } from './events.ts';
import { ScrollIndicators } from './scroll-indicators.ts';
import {
  cssFor,
  cssText,
  NODE_CLASS,
  overflowOf,
  pointerClass,
  presentStyle,
} from './style.ts';
import { SvgDom, SVG_NS } from './svg-dom.ts';
import { normalizeSvgScene, svgNaturalSize } from './svg-scene.ts';
import type {
  Accessibility,
  AnimationDescription,
  AnimationKeyframe,
  AnimationOptions,
  LayoutRect,
  NodeType,
  ScrollIntoViewOptions,
  ScrollLogicalPosition,
  ScrollToOptions,
  Style,
  SvgScene,
  UiAnimation,
} from './types.ts';

export type UiElement = HTMLElement | SVGSVGElement;

/** What a node needs of the view it belongs to. */
export interface ViewLink {
  gestures: import('../../../src/modules/ui/longPress.js').LongPresses;
  suppressPointerClick(id: number): void;
  readonly animations: AnimationController;
  readonly rootElement: HTMLElement;
  /** The engine: the tree, its styles and its layout. */
  readonly core: EngineCore;
  /** Device pixels per logical pixel, as the view is laid out. */
  pixelScale(): number;
  /** Something the layout depends on has changed: lay out before the next paint. */
  layoutChanged(): void;
  /** Lays the view out now, if anything changed. */
  flushLayout(): void;
  /** Calls `listener` after each layout; returns what stops it. */
  onLayout(listener: () => void): () => void;
  /** CSS pixels per logical pixel (the host may scale the view). */
  scale(): number;
  focusedNode(): UiNode | null;
  /** Whether the focused node shows its focus (UiNode.focusVisible). */
  focusVisible(): boolean;
  focus(node: UiNode | null): void;
  requestPointerLock(node: UiNode): Promise<void>;
  /**
   * Something assistive technology perceives, or the cursor (a style, the
   * tree), may have changed.
   */
  semanticsChanged(): void;
  /**
   * Where the browser and the engine put a line's baseline in `font`
   * (cssFont()), or null where nothing can tell (no canvas).
   */
  baselines(font: string, size: number, lineHeight: number): Baselines | null;
  /** Routes the engine's records for `handle` to `node`, while it lives. */
  register(node: UiNode, handle: number): void;
  /** The URL of a bundled asset (an image's source), or null for none. */
  assetUrl(id: string): string | null;
}

/** What ResizeObserver measures of a node, in logical pixels. */
export interface ResizeBoxes {
  readonly borderWidth: number;
  readonly borderHeight: number;
  /** Where the content box starts, inside the border and padding. */
  readonly contentX: number;
  readonly contentY: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
  /** Device pixels per logical pixel, as laid out. */
  readonly scale: number;
}

const CONSTRUCTING = Symbol('constructing');

const ELEMENTS: Record<NodeType, { tag: string; className: string }> = {
  view: { tag: 'div', className: NODE_CLASS },
  text: { tag: 'div', className: `${NODE_CLASS} sd-text` },
  image: { tag: 'img', className: `${NODE_CLASS} sd-image` },
  input: { tag: 'input', className: `${NODE_CLASS} sd-input` },
  canvas: { tag: 'canvas', className: `${NODE_CLASS} sd-canvas` },
  svg: { tag: 'svg', className: `${NODE_CLASS} sd-svg` },
};

/** The node an element draws. */
const nodes = new WeakMap<Element, UiNode>();

/** The node drawn by `element` or its nearest ancestor that draws one. */
export function nodeOf(element: Element | null, root: Element): UiNode | null {
  for (let at = element; at !== null; at = at.parentElement) {
    const node = nodes.get(at);
    if (node !== undefined) return node;
    if (at === root) return null;
  }
  return null;
}

const ZERO: LayoutRect = Object.freeze({ x: 0, y: 0, width: 0, height: 0 });

const EMPTY_FRAME: Frame = {
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  border: [0, 0, 0, 0],
  padding: [0, 0, 0, 0],
};

/** How long a smooth scroll takes: the engine's `smoothScrollMilliseconds`. */
export const SMOOTH_SCROLL_MS = 300;

/** Whether a scroll `behavior` is smooth: 'auto' and 'instant' are not. */
function scrollBehavior(value: unknown): boolean {
  if (value === undefined || value === 'auto' || value === 'instant')
    return false;
  if (value === 'smooth') return true;
  throw new TypeError(
    `The provided value '${String(value)}' is not a valid enum value of type ScrollBehavior.`,
  );
}

function scrollAlignment(value: unknown): ScrollLogicalPosition {
  if (
    value === 'start' ||
    value === 'center' ||
    value === 'end' ||
    value === 'nearest'
  )
    return value;
  throw new TypeError(
    `The provided value '${String(value)}' is not a valid enum value of type ScrollLogicalPosition.`,
  );
}

/**
 * The offset that shows a box at `start` (from the view's content box),
 * `size` long, in a view `room` long scrolled to `scrolled`.
 */
function align(
  alignment: ScrollLogicalPosition,
  scrolled: number,
  start: number,
  size: number,
  room: number,
): number {
  const end = start + size - room;
  switch (alignment) {
    case 'start':
      return start;
    case 'center':
      return start + (size - room) / 2;
    case 'end':
      return end;
    case 'nearest':
      return Math.min(
        Math.max(scrolled, Math.min(start, end)),
        Math.max(start, end),
      );
  }
}

/** Yoga leaves NaN in some boxes, which `left` and the like would ignore. */
const finite = (value: number): number => (Number.isFinite(value) ? value : 0);

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'object')
    return (value as object).constructor?.name ?? 'object';
  return typeof value;
}

/** A drawing buffer side as the native runtime takes it: negative is the default. */
function canvasSize(value: number, fallback: number): number {
  const size = Math.trunc(Number(value));
  return size >= 0 ? size : fallback;
}

function expectNode(value: unknown, what: string): UiNode {
  if (!(value instanceof UiNode)) {
    throw new TypeError(`${what} must be a UiNode, got ${describe(value)}`);
  }
  return value;
}

/** `style` with `key` set to `value`, or without it for '', null or undefined. */
function withProperty(
  style: Readonly<Style>,
  key: PropertyKey,
  value: unknown,
): Style {
  const next: Record<PropertyKey, unknown> = { ...style };
  if (value === '' || value === null || value === undefined) delete next[key];
  else next[key] = value;
  return next as Style;
}

/** Context methods that take an image source, by context type. */
const SOURCE_METHODS: Record<string, readonly string[] | undefined> = {
  '2d': ['drawImage', 'createPattern'],
  webgl2: ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D'],
};

/** Contexts whose methods already take nodes. */
const withNodeSources = new WeakSet<object>();

/** A canvas or image node as the element the browser draws from. */
function imageSourceOf(value: unknown): unknown {
  if (!(value instanceof UiNode)) return value;
  const type = value.type;
  return type === 'canvas' || type === 'image'
    ? UiNode.elementOf(value)
    : value;
}

export class UiNode extends TreeEventTarget {
  readonly #view: ViewLink;
  readonly #type: NodeType;
  readonly #element: UiElement;
  readonly #svg: SvgDom | null;
  readonly #root: boolean;
  /** The classes of a root node's element. */
  readonly #rootClass: string;
  #parent: UiNode | null = null;
  #children: UiNode[] = [];
  #style: Readonly<Style> = Object.freeze({});
  #styleView: Style | null = null;
  #text = '';
  #focusable = false;
  #tabStop = true;
  #source = '';
  #accessibility: Readonly<Accessibility> = Object.freeze({});
  #semantics: NormalizedAccessibility = normalizeAccessibility({});
  #accessibilityParent: UiNode | null = null;
  #debugId = '';
  /** Its node in the engine. */
  readonly #handle: number;
  /** Its box, as the engine last laid it out; null until it is. */
  #frame: Frame | null = null;
  /** A text or input node's text as last laid out. */
  #lines: TextLines | null = null;
  /** A scroll view's content and client size, as last laid out. */
  #extent: Extent | null = null;
  /** How far an input's text is moved for its baseline (#inputShift()). */
  #shift = 0;
  /** Where it was last placed, in CSS; kept when its style replaces its CSS. */
  #placement = '';
  /** What shows a text's lines, in the element. */
  readonly #textLines: HTMLElement | null = null;
  /**
   * While its style scrolls (a view's): the element showing how far it
   * scrolls, its indicators, and what ends its listening when it stops.
   */
  #scrollExtent: HTMLElement | null = null;
  #extentWidth = 0;
  #extentHeight = 0;
  #indicators: ScrollIndicators | null = null;
  #scrollListening: AbortController | null = null;
  #scrollIndicators = true;
  /** A smooth scroll on its way (scrollTo() with behavior 'smooth'). */
  #smooth: {
    from: { x: number; y: number };
    to: { x: number; y: number };
    started: number;
    frame: number;
  } | null = null;

  /** Nodes are made with createView(), createText() and the like. */
  constructor(
    token: symbol,
    view: ViewLink,
    type: NodeType,
    root?: { element: HTMLElement; handle: number; overlay: boolean },
  ) {
    if (token !== CONSTRUCTING) {
      throw new TypeError(
        'Illegal constructor: use createView(), createText() and the like',
      );
    }
    super();
    this.#view = view;
    this.#type = type;
    this.#root = root !== undefined;
    this.#rootClass = !root
      ? ''
      : root.overlay
        ? 'sd-root sd-overlay'
        : 'sd-root';
    this.#handle = root?.handle ?? view.core.create(type);
    view.register(this, this.#handle);
    const { tag, className } = ELEMENTS[type];
    this.#element =
      root?.element ??
      (type === 'svg'
        ? view.rootElement.ownerDocument.createElementNS(SVG_NS, 'svg')
        : view.rootElement.ownerDocument.createElement(tag));
    this.#element.setAttribute(
      'class',
      [className, this.#rootClass].filter(Boolean).join(' '),
    );
    this.#svg =
      type === 'svg' ? new SvgDom(this.#element as SVGSVGElement) : null;
    this.#svgStyle({});
    if (type === 'image') {
      const image = this.#element as HTMLImageElement;
      image.alt = '';
      image.draggable = false;
      // Its natural size is known now, and it may be sized by it.
      image.addEventListener('load', () =>
        this.#naturalSize(image.naturalWidth || 0, image.naturalHeight || 0),
      );
    }
    if (type === 'input') {
      const input = this.#element as HTMLInputElement;
      input.type = 'text';
      input.spellcheck = false;
      input.autocomplete = 'off';
      input.tabIndex = -1;
      this.#focusable = true;
      // What is typed sizes it too, as natively.
      input.addEventListener('input', () => {
        this.#view.core.text(this.#handle, input.value);
        this.#view.layoutChanged();
      });
    }
    if (type === 'text') {
      this.#textLines = view.rootElement.ownerDocument.createElement('div');
      this.#textLines.className = 'sd-text-lines';
      this.#element.append(this.#textLines);
    }
    nodes.set(this.#element, this);
  }

  /** 'view', 'text', 'image', 'input', 'canvas' or 'svg'. */
  get type(): NodeType {
    return this.#type;
  }

  get parent(): UiNode | null {
    return this.#parent;
  }

  /** A snapshot of the children, in order. */
  get children(): readonly UiNode[] {
    return Object.freeze([...this.#children]);
  }

  get firstChild(): UiNode | null {
    return this.#children[0] ?? null;
  }

  get lastChild(): UiNode | null {
    return this.#children.at(-1) ?? null;
  }

  get nextSibling(): UiNode | null {
    if (this.#parent === null) return null;
    const siblings = this.#parent.#children;
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }

  get previousSibling(): UiNode | null {
    if (this.#parent === null) return null;
    const siblings = this.#parent.#children;
    return siblings[siblings.indexOf(this) - 1] ?? null;
  }

  /** Whether the node is in the view's trees (under a root). */
  get isConnected(): boolean {
    if (this.#root) return true;
    for (let node = this.#parent; node !== null; node = node.#parent) {
      if (node.#root) return true;
    }
    return false;
  }

  // ── Style and content ──────────────────────────────────────────────────────

  /** The style last set; assigning replaces it as a whole. */
  /**
   * The node's style. Setting it replaces the whole style; setting one of its
   * properties (`node.style.width = 120`, as on the Web) restyles the node
   * with that property changed, and '' or null removes it. Lengths may be
   * written as CSS pixels ('120px'), like in the native runtime.
   */
  get style(): Style {
    this.#styleView ??= new Proxy({} as Style, {
      get: (_, key) => (this.#style as Record<PropertyKey, unknown>)[key],
      has: (_, key) => key in this.#style,
      ownKeys: () => Reflect.ownKeys(this.#style),
      getOwnPropertyDescriptor: (_, key) =>
        Object.hasOwn(this.#style, key)
          ? {
              value: (this.#style as Record<PropertyKey, unknown>)[key],
              writable: true,
              enumerable: true,
              configurable: true,
            }
          : undefined,
      set: (_, key, value) => {
        this.style = withProperty(this.#style, key, value);
        return true;
      },
      deleteProperty: (_, key) => {
        this.style = withProperty(this.#style, key, null);
        return true;
      },
      defineProperty: () => false,
    });
    return this.#styleView;
  }

  set style(value: Readonly<Style>) {
    const style = presentStyle(value);
    // Read by the engine, as natively: an invalid style throws, and the node
    // keeps the one it had.
    this.#view.core.style(this.#handle, style);
    // Where it was scrolled, while the browser still has it as it was.
    const scrolled = {
      x: this.#element.scrollLeft,
      y: this.#element.scrollTop,
    };
    this.#element.style.cssText =
      cssText(cssFor(style, this.#type)) + this.#placement;
    const { className } = ELEMENTS[this.#type];
    const scrolls = this.#type === 'view' && overflowOf(style).scrolls;
    this.#element.setAttribute(
      'class',
      [className, scrolls && 'sd-scroll', this.#rootClass, pointerClass(style)]
        .filter(Boolean)
        .join(' '),
    );
    this.#svgStyle(style);
    this.#style = Object.freeze({ ...style });
    this.#scrollingChanged(scrolled);
    this.#view.layoutChanged();
    this.#view.semanticsChanged();
  }

  #svgScene: SvgScene | null = null;

  #svgStyle(style: Readonly<Style>): void {
    if (!this.#svg) return;
    // A vector viewport always clips, like Image/Canvas content. Layout Style
    // transforms affect the outer box; scene transforms are inside it.
    this.#element.style.overflow = 'hidden';
    this.#element.style.display = style.display === 'none' ? 'none' : 'block';
    this.#element.style.transformBox = 'border-box';
    this.#element.style.transformOrigin = '50% 50%';
  }

  /** Atomically replaces the vector snapshot after complete validation. */
  setSvgScene(scene: SvgScene | null): void {
    this.#expect('svg', 'setSvgScene()');
    const normalized = scene === null ? null : normalizeSvgScene(scene);
    const [width, height] = svgNaturalSize(this.#svgScene);
    this.#svg!.update(normalized);
    this.#svgScene = normalized;
    const [newWidth, newHeight] = svgNaturalSize(normalized);
    if (width !== newWidth || height !== newHeight)
      this.#naturalSize(newWidth, newHeight);
    this.#view.semanticsChanged();
  }

  /** The text of a text node, or the value of an input. */
  get text(): string {
    return this.#type === 'input' ? this.#input().value : this.#text;
  }

  set text(value: string) {
    if (this.#type !== 'text' && this.#type !== 'input') {
      throw new TypeError('only text and input nodes have text');
    }
    const text = String(value);
    // Shown at once, on one line, until the engine wraps it.
    if (this.#type === 'input') this.#input().value = text;
    else this.#textLines!.textContent = text;
    const changed = text !== this.#text;
    this.#text = text;
    if (changed) {
      this.#view.core.text(this.#handle, text);
      this.#view.layoutChanged();
    }
    this.#view.semanticsChanged();
  }

  /** An input's text. Setting it puts the caret at its end. */
  get value(): string {
    this.#expect('input', 'value');
    return this.#input().value;
  }

  set value(value: string) {
    this.#expect('input', 'value');
    this.text = value;
    const end = this.#input().value.length;
    this.#input().setSelectionRange(end, end);
  }

  /** An input's hint, shown while it is empty. */
  get placeholder(): string {
    this.#expect('input', 'placeholder');
    return this.#input().placeholder;
  }

  set placeholder(value: string) {
    this.#expect('input', 'placeholder');
    this.#input().placeholder = String(value);
    this.#view.core.placeholder(this.#handle, this.#input().placeholder);
    this.#view.layoutChanged();
  }

  /** The selection in UTF-16 indices, as the DOM reports it. */
  get selectionStart(): number {
    this.#expect('input', 'selectionStart');
    return this.#input().selectionStart ?? 0;
  }

  get selectionEnd(): number {
    this.#expect('input', 'selectionEnd');
    return this.#input().selectionEnd ?? 0;
  }

  /** Browsers may say 'none'; Soundor has forward and backward only. */
  get selectionDirection(): 'forward' | 'backward' {
    this.#expect('input', 'selectionDirection');
    return this.#input().selectionDirection === 'backward'
      ? 'backward'
      : 'forward';
  }

  /** Selects [start, end) of an input's text (UTF-16 indices), clamped. */
  setSelectionRange(
    start: number,
    end: number,
    direction: 'forward' | 'backward' = 'forward',
  ): void {
    this.#expect('input', 'setSelectionRange()');
    const length = this.#input().value.length;
    const from = Math.max(0, Math.min(Number(start) || 0, length));
    const to = Math.max(from, Math.min(Number(end) || 0, length));
    this.#input().setSelectionRange(
      from,
      to,
      direction === 'backward' ? 'backward' : 'forward',
    );
  }

  select(): void {
    this.setSelectionRange(0, this.#input().value.length);
  }

  /** An image's asset id (what `import logo from './logo.png'` yields). */
  get source(): string {
    this.#expect('image', 'source');
    return this.#source;
  }

  set source(value: string) {
    this.#expect('image', 'source');
    this.#source = value === null || value === undefined ? '' : String(value);
    const image = this.#element as HTMLImageElement;
    // An id that names no asset shows nothing, as natively.
    const url = this.#view.assetUrl(this.#source);
    if (url !== null) {
      const href = new URL(url, image.ownerDocument.baseURI).href;
      if (image.src !== href) {
        image.src = href;
        // Sized by the new image once it loads; nothing until then.
        this.#naturalSize(0, 0);
      }
    } else {
      image.removeAttribute('src');
      this.#naturalSize(0, 0);
    }
  }

  // ── Canvases ───────────────────────────────────────────────────────────────

  /**
   * A canvas's drawing buffer, in pixels (300 by 150 to begin with); shown
   * stretched over the node's box. Setting either clears the canvas. The
   * element is a real <canvas>, so its contexts are the browser's.
   */
  get width(): number {
    this.#expect('canvas', 'width');
    return this.#canvas().width;
  }

  set width(value: number) {
    this.#expect('canvas', 'width');
    this.#canvas().width = canvasSize(value, 300);
    this.#naturalSize(this.#canvas().width, this.#canvas().height);
  }

  get height(): number {
    this.#expect('canvas', 'height');
    return this.#canvas().height;
  }

  set height(value: number) {
    this.#expect('canvas', 'height');
    this.#canvas().height = canvasSize(value, 150);
    this.#naturalSize(this.#canvas().width, this.#canvas().height);
  }

  /**
   * The canvas's context: the browser's own, as `<canvas>.getContext()`
   * gives, for the types the native runtime has too ('2d' and 'webgl2'; null
   * for others). Its methods taking an image also take canvas and image nodes.
   */
  getContext(type: string, options?: unknown): unknown {
    this.#expect('canvas', 'getContext()');
    const kind = String(type);
    const methods = SOURCE_METHODS[kind];
    if (methods === undefined) return null;
    const context = this.#canvas().getContext(kind, options as never);
    if (context !== null && !withNodeSources.has(context)) {
      withNodeSources.add(context);
      for (const name of methods) {
        const record = context as unknown as Record<string, unknown>;
        const original = record[name] as (...args: unknown[]) => unknown;
        Object.defineProperty(context, name, {
          value(this: unknown, ...args: unknown[]) {
            return original.apply(this, args.map(imageSourceOf));
          },
          writable: true,
          configurable: true,
        });
      }
    }
    return context;
  }

  #canvas(): HTMLCanvasElement {
    return this.#element as HTMLCanvasElement;
  }

  // ── Scrolling ──────────────────────────────────────────────────────────────

  /** How far a scroll view's content is scrolled. */
  get scrollTop(): number {
    return this.#element.scrollTop;
  }

  set scrollTop(value: number) {
    this.scrollTo({ top: value });
  }

  get scrollLeft(): number {
    return this.#element.scrollLeft;
  }

  set scrollLeft(value: number) {
    this.scrollTo({ left: value });
  }

  /** The size of what a scroll view scrolls. */
  get scrollWidth(): number {
    return this.#contentSize().width;
  }

  get scrollHeight(): number {
    return this.#contentSize().height;
  }

  /** How much of that shows: its content box. */
  get clientWidth(): number {
    return this.#clientSize().width;
  }

  get clientHeight(): number {
    return this.#clientSize().height;
  }

  #clientSize(): { width: number; height: number } {
    this.#view.flushLayout();
    const frame = this.#frame;
    if (frame === null || !this.isConnected) return { width: 0, height: 0 };
    const [top, right, bottom, left] = frame.border;
    const [paddingTop, paddingRight, paddingBottom, paddingLeft] =
      frame.padding;
    return {
      width: Math.max(
        0,
        frame.width - left - paddingLeft - right - paddingRight,
      ),
      height: Math.max(
        0,
        frame.height - top - paddingTop - bottom - paddingBottom,
      ),
    };
  }

  /** Whether a scroll view draws its own indicators. */
  get scrollIndicators(): boolean {
    return this.#scrollIndicators;
  }

  set scrollIndicators(value: boolean) {
    this.#scrollIndicators = Boolean(value);
    this.#indicators?.setEnabled(this.#scrollIndicators);
  }

  /**
   * The children's extent, plus the padding at the far ends: the engine's
   * `Surface::contentSize()`, reported with every layout for a scroll view
   * and asked for otherwise.
   */
  #contentSize(): { width: number; height: number } {
    if (!this.isConnected) return { width: 0, height: 0 };
    this.#view.flushLayout();
    const extent =
      this.#scrollExtent !== null && this.#extent !== null
        ? this.#extent
        : this.#view.core.extent(this.#handle);
    return { width: extent.contentWidth, height: extent.contentHeight };
  }

  /** Where the node last told of being scrolled to. */
  #announcedLeft = 0;
  #announcedTop = 0;

  /**
   * Fires `scroll` if the node is somewhere it has not said: once, whichever
   * comes first of the wheel's or a drag's at once, and the browser's event
   * on the next frame.
   */
  #announceScroll(): void {
    const { scrollLeft, scrollTop } = this.#element;
    if (scrollLeft === this.#announcedLeft && scrollTop === this.#announcedTop)
      return;
    this.#announcedLeft = scrollLeft;
    this.#announcedTop = scrollTop;
    this.dispatchEvent(new Event('scroll', { composed: true }));
  }

  /** @internal The wheel scrolled it: tells it at once, as natively. */
  static scrolled(node: UiNode): void {
    node.#announceScroll();
  }

  /** @internal Whether its style scrolls an axis: a view's only. */
  static scrolls(node: UiNode): boolean {
    return node.#scrollExtent !== null;
  }

  /**
   * Starts or stops what scrolling takes, as its style says; and what no
   * longer scrolls goes back to its start, told on the next frame, as
   * natively (`Surface::scrollingChanged()`).
   */
  #scrollingChanged(scrolled: { x: number; y: number }): void {
    const overflow = overflowOf(this.#style);
    const view = this.#type === 'view';
    const scrollsX = view && overflow.x === 'scroll';
    const scrollsY = view && overflow.y === 'scroll';
    if ((scrollsX || scrollsY) && this.#scrollExtent === null)
      this.#startScrolling();
    const element = this.#element;
    if ((!scrollsX && scrolled.x !== 0) || (!scrollsY && scrolled.y !== 0)) {
      if (!scrollsX) element.scrollLeft = 0;
      if (!scrollsY) element.scrollTop = 0;
      element.ownerDocument.defaultView?.requestAnimationFrame(() =>
        this.#announceScroll(),
      );
    }
    if (!scrollsX && !scrollsY) {
      this.#cancelSmooth();
      if (this.#scrollExtent !== null) this.#stopScrolling();
    } else this.#placeScrollExtent();
  }

  #startScrolling(): void {
    const element = this.#element as HTMLElement;
    this.#scrollExtent = element.ownerDocument.createElement('div');
    this.#scrollExtent.className = 'sd-scroll-extent';
    element.prepend(this.#scrollExtent);
    // A drag of its bar scrolls as the wheel does: told at once, and the end
    // of a smooth scroll.
    this.#indicators = new ScrollIndicators(
      element,
      () => {
        this.#cancelSmooth();
        this.#announceScroll();
      },
      () => this.inputDisabled,
    );
    this.#indicators.setEnabled(this.#scrollIndicators);
    // Scrolling from code is told by the browser's own event, as natively
    // on the next frame, before its requestAnimationFrame callbacks.
    this.#scrollListening = new AbortController();
    element.addEventListener('scroll', () => this.#announceScroll(), {
      passive: true,
      signal: this.#scrollListening.signal,
    });
  }

  #stopScrolling(): void {
    this.#indicators?.dispose();
    this.#indicators = null;
    this.#scrollExtent?.remove();
    this.#scrollExtent = null;
    this.#extentWidth = 0;
    this.#extentHeight = 0;
    this.#scrollListening?.abort();
    this.#scrollListening = null;
  }

  /** Where scrolling may go: the engine's contentSize() less its client size. */
  #scrollRange(): { x: number; y: number } {
    const overflow = overflowOf(this.#style);
    const content = this.#contentSize();
    const client = this.#clientSize();
    return {
      x:
        overflow.x === 'scroll' ? Math.max(0, content.width - client.width) : 0,
      y:
        overflow.y === 'scroll'
          ? Math.max(0, content.height - client.height)
          : 0,
    };
  }

  /**
   * Puts it at `x`, `y` at once; whether it moved. The browser keeps an axis
   * that scrolls within the extent, which ends where the engine clamps; the
   * one that does not stays at 0, though the browser would scroll it.
   */
  #scrollAt(x: number, y: number): boolean {
    const overflow = overflowOf(this.#style);
    const element = this.#element;
    const before = { x: element.scrollLeft, y: element.scrollTop };
    element.scrollLeft = overflow.x === 'scroll' ? x : 0;
    element.scrollTop = overflow.y === 'scroll' ? y : 0;
    this.#indicators?.place();
    return element.scrollLeft !== before.x || element.scrollTop !== before.y;
  }

  #cancelSmooth(): void {
    if (this.#smooth === null) return;
    this.#element.ownerDocument.defaultView?.cancelAnimationFrame(
      this.#smooth.frame,
    );
    this.#smooth = null;
  }

  /**
   * scrollTo({ top, left, behavior }) or scrollTo(left, top): along the axes
   * its style scrolls, clamped to the content; nothing on a node that does
   * not scroll, as in browsers.
   */
  scrollTo(optionsOrLeft?: ScrollToOptions | number, top?: number): void {
    const options =
      typeof optionsOrLeft === 'object' && optionsOrLeft !== null
        ? optionsOrLeft
        : null;
    const smooth = scrollBehavior(options?.behavior);
    if (this.#scrollExtent === null) return;
    const element = this.#element;
    const target =
      options !== null
        ? {
            x: options.left ?? element.scrollLeft,
            y: options.top ?? element.scrollTop,
          }
        : {
            x: (optionsOrLeft as number | undefined) ?? element.scrollLeft,
            y: top ?? element.scrollTop,
          };
    const x = Number(target.x) || 0;
    const y = Number(target.y) || 0;
    this.#cancelSmooth();
    const window = element.ownerDocument.defaultView;
    if (!smooth || this.#view.animations.reducedMotion || window === null) {
      this.#scrollAt(x, y);
      return;
    }
    const range = this.#scrollRange();
    const to = {
      x: Math.min(Math.max(x, 0), range.x),
      y: Math.min(Math.max(y, 0), range.y),
    };
    const from = { x: element.scrollLeft, y: element.scrollTop };
    if (to.x === from.x && to.y === from.y) return;
    // As natively (`Surface::deliverScrolls()`): eased in and out, from the
    // next frame, each step told as it is taken.
    const step = (): void => {
      const smooth = this.#smooth;
      if (smooth === null) return;
      const progress = Math.min(
        1,
        Math.max(
          0,
          (window.performance.now() - smooth.started) / SMOOTH_SCROLL_MS,
        ),
      );
      const eased = standardEase('ease-in-out', progress);
      this.#scrollAt(
        smooth.from.x + (smooth.to.x - smooth.from.x) * eased,
        smooth.from.y + (smooth.to.y - smooth.from.y) * eased,
      );
      if (progress >= 1) this.#smooth = null;
      else smooth.frame = window.requestAnimationFrame(step);
      this.#announceScroll();
    };
    this.#smooth = {
      from,
      to,
      started: window.performance.now(),
      frame: window.requestAnimationFrame(step),
    };
  }

  /** scrollBy({ top, left, behavior }) or scrollBy(left, top): from where it is. */
  scrollBy(optionsOrLeft?: ScrollToOptions | number, top?: number): void {
    const element = this.#element;
    const options =
      typeof optionsOrLeft === 'object' && optionsOrLeft !== null
        ? optionsOrLeft
        : null;
    const delta =
      options !== null
        ? { x: options.left ?? 0, y: options.top ?? 0 }
        : { x: (optionsOrLeft as number | undefined) ?? 0, y: top ?? 0 };
    this.scrollTo({
      left: element.scrollLeft + (Number(delta.x) || 0),
      top: element.scrollTop + (Number(delta.y) || 0),
      behavior: options?.behavior,
    });
  }

  /**
   * Scrolls the views around it that scroll to show it, as
   * Element.scrollIntoView() and the engine's `Surface::scrollIntoView()`:
   * innermost first, by layout boxes.
   */
  scrollIntoView(arg?: boolean | ScrollIntoViewOptions): void {
    const options: ScrollIntoViewOptions =
      typeof arg === 'object' && arg !== null
        ? arg
        : { block: arg === false ? 'end' : 'start' };
    const block = scrollAlignment(options.block ?? 'start');
    const inline = scrollAlignment(options.inline ?? 'nearest');
    const behavior = options.behavior;
    scrollBehavior(behavior);
    if (!this.isConnected) return;
    this.#view.flushLayout();
    const planned = new Map<UiNode, { x: number; y: number }>();
    const own = this.layout;
    const box = { x: own.x, y: own.y, width: own.width, height: own.height };
    for (let view = this.#parent; view !== null; view = view.#parent) {
      const frame = view.#frame ?? EMPTY_FRAME;
      if (view.#scrollExtent !== null && view.#style.display !== 'none') {
        const left = frame.border[3] + frame.padding[3];
        const top = frame.border[0] + frame.padding[0];
        const client = view.#clientSize();
        const range = view.#scrollRange();
        const element = view.#element;
        const wanted = {
          x: align(
            inline,
            element.scrollLeft,
            box.x - left,
            box.width,
            client.width,
          ),
          y: align(
            block,
            element.scrollTop,
            box.y - top,
            box.height,
            client.height,
          ),
        };
        const to = {
          x: Math.min(Math.max(wanted.x, 0), range.x),
          y: Math.min(Math.max(wanted.y, 0), range.y),
        };
        planned.set(view, to);
        box.x -= to.x;
        box.y -= to.y;
      } else {
        box.x -= view.#element.scrollLeft;
        box.y -= view.#element.scrollTop;
      }
      box.x += frame.x;
      box.y += frame.y;
    }
    for (const [view, to] of planned)
      view.scrollTo({ left: to.x, top: to.y, behavior });
  }

  // ── Accessibility ──────────────────────────────────────────────────────────

  /** What the node is to assistive technology; assigning replaces it. */
  get accessibility(): Readonly<Accessibility> {
    return this.#accessibility;
  }

  set accessibility(value: Readonly<Accessibility>) {
    this.#semantics = normalizeAccessibility(value);
    this.#accessibility = freezeAccessibility(value);
    this.#view.semanticsChanged();
  }

  get inputDisabled(): boolean {
    for (let node: UiNode | null = this; node !== null; node = node.parent)
      if (node.#semantics.state.disabled) return true;
    return false;
  }

  /** Where assistive technology reads the node, in place of its parent. */
  get accessibilityParent(): UiNode | null {
    return this.#accessibilityParent;
  }

  set accessibilityParent(value: UiNode | null) {
    if (value !== null && value !== undefined)
      expectNode(value, 'accessibilityParent');
    if (value === this)
      throw new Error('a node cannot be its own accessibility parent');
    this.#accessibilityParent = value ?? null;
    this.#view.semanticsChanged();
  }

  /**
   * The name developer tools (DevTools, Soundor Driver) find the node by;
   * empty for none. Not shown, nor read to assistive technology.
   */
  get debugId(): string {
    return this.#debugId;
  }

  set debugId(value: string) {
    const debugId = String(value ?? '');
    if (debugId.length > 128)
      throw new RangeError('debugId is at most 128 characters');
    this.#debugId = debugId;
    if (debugId) this.#element.dataset['soundorDebugId'] = debugId;
    else delete this.#element.dataset['soundorDebugId'];
  }

  // ── Focus ──────────────────────────────────────────────────────────────────

  /** Whether the node takes focus when pressed or tabbed to. */
  get focusable(): boolean {
    return this.#focusable;
  }

  set focusable(value: boolean) {
    this.#focusable = Boolean(value);
    if (this.#type === 'input') return;
    if (this.#focusable) this.#element.tabIndex = -1;
    else if (!this.#root) this.#element.removeAttribute('tabindex');
    this.#view.semanticsChanged();
  }

  /**
   * Whether Tab and Shift+Tab stop at the node when it is focusable; true
   * by default. False keeps it focusable by a press or focus() only.
   */
  get tabStop(): boolean {
    return this.#tabStop;
  }

  set tabStop(value: boolean) {
    this.#tabStop = Boolean(value);
  }

  get focused(): boolean {
    return this.#view.focusedNode() === this;
  }

  /**
   * Whether it has focus and should show it, as CSS's :focus-visible (by
   * the native runtime's rules, not the browser's): focus a pointer press
   * moved is not shown, unless a key is pressed after.
   */
  get focusVisible(): boolean {
    return this.focused && this.#view.focusVisible();
  }

  focus(): void {
    this.#view.focus(this);
  }

  /**
   * Locks the pointer pressing this node (or a node in it) to it for the
   * press: hidden, not stopped by the screen's edges, its events at the
   * position the lock began, with movementX/Y saying how far it moved. Ends
   * with the release or exitPointerLock(); the pointer shows again where it
   * began. Rejects when no mouse or pen is pressing the node.
   */
  requestPointerLock(): Promise<void> {
    return this.#view.requestPointerLock(this);
  }

  blur(): void {
    if (this.focused) this.#view.focus(null);
  }

  // ── Tree ───────────────────────────────────────────────────────────────────

  appendChild<T extends UiNode>(child: T): T {
    return this.insertBefore(child, null);
  }

  insertBefore<T extends UiNode>(child: T, before: UiNode | null): T {
    expectNode(child, 'child');
    if (before !== null && before !== undefined) expectNode(before, 'before');
    if (child.#root) throw new Error('the root node cannot be a child');
    if (this.#type !== 'view') {
      throw new Error('only views can have children');
    }
    if (child.contains(this)) throw new Error('a node cannot contain itself');
    if (before && before.#parent !== this) {
      throw new Error('the reference node is not a child of this node');
    }
    if (child === before) return child;
    const leaves = child.isConnected && !this.isConnected;
    if (child.#parent !== null) {
      const siblings = child.#parent.#children;
      siblings.splice(siblings.indexOf(child), 1);
    }
    const index = before ? this.#children.indexOf(before) : -1;
    if (index < 0) this.#children.push(child);
    else this.#children.splice(index, 0, child);
    child.#parent = this;
    this.#element.insertBefore(child.#element, before ? before.#element : null);
    // The engine moves it from wherever it was, as here.
    this.#view.core.insert(
      this.#handle,
      child.#handle,
      before ? before.#handle : 0,
    );
    if (leaves) child.#left();
    this.#view.layoutChanged();
    this.#view.semanticsChanged();
    return child;
  }

  removeChild<T extends UiNode>(child: T): T {
    expectNode(child, 'child');
    if (child.#parent !== this) {
      throw new Error('the node is not a child of this node');
    }
    const connected = this.isConnected;
    this.#children.splice(this.#children.indexOf(child), 1);
    child.#parent = null;
    child.#element.remove();
    this.#view.core.remove(this.#handle, child.#handle);
    if (connected) {
      child.#left();
      this.#view.layoutChanged();
    }
    this.#view.semanticsChanged();
    return child;
  }

  /** Removes the node from its parent, if it has one. */
  remove(): void {
    this.#parent?.removeChild(this);
  }

  contains(other: UiNode | null): boolean {
    for (let node = other; node; node = node.#parent) {
      if (node === this) return true;
    }
    return false;
  }

  // ── Layout ─────────────────────────────────────────────────────────────────

  /** The laid-out box relative to the parent's (unscrolled) box. */
  get layout(): LayoutRect {
    if (!this.isConnected) return ZERO;
    this.#view.flushLayout();
    const frame = this.#frame;
    if (frame === null) return ZERO;
    return { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
  }

  // ── The engine's layout ────────────────────────────────────────────────────

  /**
   * It (and what is in it) left the view's trees: what it showed of an
   * interaction ends. What it was laid out as stays: the engine tells what
   * differs once it is back.
   */
  #left(): void {
    this.#view.gestures.cancelWithin(this);
    this.#indicators?.release();
    for (const child of this.#children) child.#left();
  }

  /** What an image, canvas or SVG measures itself by has changed. */
  #naturalSize(width: number, height: number): void {
    this.#view.core.natural(this.#handle, width, height);
    this.#view.layoutChanged();
  }

  /** @internal The engine laid it out at `frame`: places its element there. */
  static placed(node: UiNode, frame: Frame): void {
    node.#frame = frame;
    node.#place();
    if (node.#scrollExtent !== null) node.#placeScrollExtent();
  }

  /** @internal The engine laid its text out anew. */
  static textLaidOut(node: UiNode, lines: TextLines): void {
    node.#lines = lines;
    if (node.#type === 'text') node.#placeText();
    else if (node.#type === 'input') {
      const shift = node.#inputShift();
      if (shift !== node.#shift) {
        node.#shift = shift;
        node.#place();
      }
    }
  }

  /** @internal How far a scroll view's content reaches changed. */
  static extended(node: UiNode, extent: Extent): void {
    node.#extent = extent;
    if (node.#scrollExtent !== null) node.#placeScrollExtent();
  }

  /**
   * Places the element where the engine laid it out: from its parent's
   * padding box, as an absolute box is (the engine reports that offset).
   * Writes only what moved, since a write costs the browser a layout of its own.
   */
  #place(): void {
    const frame = this.#frame;
    if (frame === null || this.#root) return;
    let placement = `left:${finite(frame.left)}px;top:${finite(frame.top)}px;width:${finite(frame.width)}px;height:${finite(frame.height)}px;`;
    // Children are placed by the engine; only what draws in its box needs padding.
    if (this.#type !== 'view') {
      const [top, right, bottom, left] = frame.padding;
      const shift = this.#type === 'input' ? this.#shift : 0;
      // Its text is centred in what padding leaves: twice, to move it once.
      placement +=
        `padding-left:${finite(left)}px;` +
        `padding-top:${finite(top) + Math.max(shift, 0) * 2}px;` +
        `padding-right:${finite(right)}px;` +
        `padding-bottom:${finite(bottom) + Math.max(-shift, 0) * 2}px;`;
    }
    if (placement === this.#placement) return;
    this.#placement = placement;
    const { style } = this.#element;
    for (const declaration of placement.split(';')) {
      const at = declaration.indexOf(':');
      if (at > 0)
        style.setProperty(declaration.slice(0, at), declaration.slice(at + 1));
    }
  }

  /** Shows the lines the engine wrapped its text into, its baseline on the engine's. */
  #placeText(): void {
    const lines = this.#lines;
    if (lines === null) return;
    this.#placeBaseline(lines);
    let shown = '';
    for (let i = 0; i < lines.lines.length; i++) {
      const line = lines.lines[i]!;
      if (i > 0) shown += '\n';
      shown += this.#text.slice(line.start, line.end);
    }
    const lineElement = this.#textLines!;
    if (lineElement.textContent !== shown) lineElement.textContent = shown;
  }

  /** Where the browser and the engine put a line's baseline in its font. */
  #baselines(lines: TextLines): Baselines | null {
    const size =
      this.#style.fontSize !== undefined && this.#style.fontSize > 0
        ? this.#style.fontSize
        : 14;
    return this.#view.baselines(lines.font, size, lines.lineHeight);
  }

  /**
   * The device pixel the engine's baseline falls on, in the view, given where
   * its line starts. The browser is then told that very pixel rather than a
   * fraction of one, for it rounds its own way: at 2x, 156.49 is 156 in the
   * engine and 157 in Chromium.
   */
  #snappedBaseline(lineTop: number, engine: number): number {
    const scale = this.#view.pixelScale();
    return Math.round((lineTop + engine) * scale) / scale;
  }

  /** Puts a text's first baseline on the engine's pixel. */
  #placeBaseline(lines: TextLines): void {
    const baselines = this.#baselines(lines);
    if (baselines === null) return;
    const contentTop = lines.contentTop;
    const top =
      this.#snappedBaseline(contentTop, baselines.engine) -
      contentTop -
      baselines.browser;
    const value = `${top}px`;
    const { style } = this.#textLines!;
    if (style.top !== value) style.top = value;
  }

  /**
   * How far to move an input's text for its baseline to be on the engine's
   * pixel (`Renderer::drawInput`: the line centred in the content box). An input
   * shows its text in a box of its own, which nothing can reach but its padding.
   */
  #inputShift(): number {
    const lines = this.#lines;
    const frame = this.#frame;
    if (lines === null || frame === null) return 0;
    const baselines = this.#baselines(lines);
    if (baselines === null) return 0;
    const contentHeight =
      finite(frame.height) -
      finite(frame.border[0]) -
      finite(frame.padding[0]) -
      finite(frame.border[2]) -
      finite(frame.padding[2]);
    const lineTop = lines.contentTop + (contentHeight - lines.lineHeight) / 2;
    return (
      this.#snappedBaseline(lineTop, baselines.engine) -
      lineTop -
      baselines.browser
    );
  }

  /**
   * How far a scroll view scrolls is the browser's, from what overflows it:
   * made to end where the engine's scrollTo() clamps, its contentSize() less
   * its content box, the box's padding being no part of what the browser
   * counts of its own.
   */
  #placeScrollExtent(): void {
    const frame = this.#frame;
    const extent = this.#extent;
    if (frame === null || extent === null || this.#scrollExtent === null)
      return;
    const [paddingTop, paddingRight, paddingBottom, paddingLeft] =
      frame.padding;
    const [borderTop, borderRight, borderBottom, borderLeft] = frame.border;
    const width = extent.contentWidth;
    const height = extent.contentHeight;
    const extentWidth = width + paddingLeft + paddingRight;
    const extentHeight = height + paddingTop + paddingBottom;
    const { style } = this.#scrollExtent;
    if (extentWidth !== this.#extentWidth) {
      this.#extentWidth = extentWidth;
      style.width = `${extentWidth}px`;
    }
    if (extentHeight !== this.#extentHeight) {
      this.#extentHeight = extentHeight;
      style.height = `${extentHeight}px`;
    }
    // An axis it does not scroll has nothing to show, however far its
    // content reaches.
    const overflow = overflowOf(this.#style);
    this.#indicators!.place({
      contentWidth: overflow.x === 'scroll' ? width : 0,
      contentHeight: overflow.y === 'scroll' ? height : 0,
      x: borderLeft,
      y: borderTop,
      clientWidth: extent.clientWidth,
      clientHeight: extent.clientHeight,
      width: Math.max(0, frame.width - borderLeft - borderRight),
      height: Math.max(0, frame.height - borderTop - borderBottom),
      borderLeft,
      borderTop,
    });
  }

  // ── Coordinates ────────────────────────────────────────────────────────────

  /** The laid-out box relative to the view (zero when not connected). */
  animate(
    keyframes: readonly AnimationKeyframe[] | AnimationDescription,
    options?: AnimationOptions,
  ): UiAnimation {
    return Array.isArray(keyframes)
      ? this.#view.animations.create(this.#element, keyframes, options)
      : this.#view.animations.createProgram(
          this.#element,
          keyframes as AnimationDescription,
          options,
        );
  }

  /** @internal Targets cannot cross runtime/view ownership. */
  animationElement(controller: AnimationController): UiElement {
    if (controller !== this.#view.animations)
      throw new TypeError('animation target belongs to another view');
    return this.#element;
  }

  getBoundingClientRect(): LayoutRect {
    if (!this.isConnected) return ZERO;
    this.#view.flushLayout();
    // As in Yoga, which zeroes a hidden node's layout and its children's:
    // nothing wide, where the nearest shown ancestor starts.
    const hidden = this.#hiddenRoot();
    if (hidden !== null) {
      const { x, y } = hidden.#parent?.getBoundingClientRect() ?? ZERO;
      return { x, y, width: 0, height: 0 };
    }
    const box = this.#rect();
    const root = this.#view.rootElement.getBoundingClientRect();
    const scale = this.#view.scale();
    return {
      x: (box.left - root.left) / scale,
      y: (box.top - root.top) / scale,
      width: box.width / scale,
      height: box.height / scale,
    };
  }

  /** The outermost node with display none from this one up, or null. */
  #hiddenRoot(): UiNode | null {
    let hidden: UiNode | null = null;
    for (let node: UiNode | null = this; node; node = node.#parent)
      if (node.#style.display === 'none') hidden = node;
    return hidden;
  }

  #transformed(): boolean {
    for (let node: UiNode | null = this; node; node = node.#parent) {
      const matrix = computedTransform(node.#element);
      if (matrix.some((value, index) => value !== IDENTITY[index])) return true;
    }
    return false;
  }

  #matrix(): Matrix {
    const box = this.layout;
    const parent = this.#parent;
    const before = parent ? parent.#matrix() : IDENTITY;
    return multiply(
      multiply(
        multiply(
          multiply(
            before,
            translation(
              box.x - (parent ? parent.#element.scrollLeft : 0),
              box.y - (parent ? parent.#element.scrollTop : 0),
            ),
          ),
          translation(box.width / 2, box.height / 2),
        ),
        computedTransform(this.#element),
      ),
      translation(-box.width / 2, -box.height / 2),
    );
  }

  static localPoint(
    node: UiNode,
    x: number,
    y: number,
  ): { x: number; y: number } {
    if (node.#transformed()) return inversePoint(node.#matrix(), x, y);
    const box = node.getBoundingClientRect();
    return { x: x - box.x, y: y - box.y };
  }

  [eventParent](): UiNode | null {
    return this.#parent;
  }

  #rect(): DOMRect {
    return this.#element.getBoundingClientRect();
  }

  #input(): HTMLInputElement {
    return this.#element as HTMLInputElement;
  }

  #expect(type: NodeType, what: string): void {
    if (this.#type !== type) {
      throw new TypeError(`${what} belongs to ${type} nodes`);
    }
  }

  /** For the view: the element that draws `node`. */
  static elementOf(node: UiNode): UiElement {
    return node.#element;
  }

  /**
   * For ResizeObserver: the node's border and content boxes as laid out, as
   * the engine measures them; null when it is not in the view.
   */
  static resizeBoxes(node: UiNode): ResizeBoxes | null {
    if (!node.isConnected) return null;
    node.#view.flushLayout();
    const frame = node.#frame;
    if (frame === null) return null;
    const [borderTop, borderRight, borderBottom, borderLeft] = frame.border;
    const [paddingTop, paddingRight, paddingBottom, paddingLeft] =
      frame.padding;
    const left = borderLeft + paddingLeft;
    const top = borderTop + paddingTop;
    const right = borderRight + paddingRight;
    const bottom = borderBottom + paddingBottom;
    return {
      borderWidth: frame.width,
      borderHeight: frame.height,
      contentX: left,
      contentY: top,
      contentWidth: Math.max(0, frame.width - left - right),
      contentHeight: Math.max(0, frame.height - top - bottom),
      scale: node.#view.pixelScale(),
    };
  }

  /** For ResizeObserver: the node's depth in its tree, its root's 1. */
  static depthOf(node: UiNode): number {
    let depth = 1;
    for (let parent = node.#parent; parent !== null; parent = parent.#parent)
      ++depth;
    return depth;
  }

  /** For ResizeObserver: the view the node belongs to. */
  static viewOf(node: UiNode): ViewLink {
    return node.#view;
  }

  /** For the view: what plugin code said about `node`, checked. */
  static semanticsOf(node: UiNode): NormalizedAccessibility {
    return node.#semantics;
  }
}

/**
 * Creates a node of `type` for `view`. A root (the content's, or the
 * overlay's) takes its element.
 */
export function createNode(
  view: ViewLink,
  type: NodeType,
  root?: { element: HTMLElement; handle: number; overlay: boolean },
): UiNode {
  return new UiNode(CONSTRUCTING, view, type, root);
}
