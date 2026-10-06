/**
 * `UiNode`: a node of the plugin view, drawn by one DOM element. Plugin code
 * only ever sees UiNodes; the element is this module's business. The tree,
 * its rules and errors follow the JUCE runtime (`soundor:ui` there).
 */

import { ASSET_PATH, isAssetId } from '../protocol';
import {
  freezeAccessibility,
  normalizeAccessibility,
  type NormalizedAccessibility,
} from './accessibility';
import { eventParent, TreeEventTarget } from './events';
import { cssFor, cssText, NODE_CLASS, pointerClass, readStyle } from './style';
import type { Accessibility, LayoutRect, NodeType, Style } from './types';

/** What a node needs of the view it belongs to. */
export interface ViewLink {
  readonly rootElement: HTMLElement;
  /** CSS pixels per logical pixel (the host may scale the view). */
  scale(): number;
  focusedNode(): UiNode | null;
  focus(node: UiNode | null): void;
  /** Something assistive technology perceives may have changed. */
  semanticsChanged(): void;
}

const CONSTRUCTING = Symbol('constructing');

const ELEMENTS: Record<NodeType, { tag: string; className: string }> = {
  view: { tag: 'div', className: NODE_CLASS },
  text: { tag: 'div', className: `${NODE_CLASS} sd-text` },
  image: { tag: 'img', className: `${NODE_CLASS} sd-image` },
  scroll: { tag: 'div', className: `${NODE_CLASS} sd-scroll` },
  input: { tag: 'input', className: `${NODE_CLASS} sd-input` },
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

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'object')
    return (value as object).constructor?.name ?? 'object';
  return typeof value;
}

function expectNode(value: unknown, what: string): UiNode {
  if (!(value instanceof UiNode)) {
    throw new TypeError(`${what} must be a UiNode, got ${describe(value)}`);
  }
  return value;
}

export class UiNode extends TreeEventTarget {
  readonly #view: ViewLink;
  readonly #type: NodeType;
  readonly #element: HTMLElement;
  readonly #root: boolean;
  /** The classes of a root node's element. */
  readonly #rootClass: string;
  #parent: UiNode | null = null;
  #children: UiNode[] = [];
  #style: Readonly<Style> = Object.freeze({});
  #text = '';
  #focusable = false;
  #source = '';
  #accessibility: Readonly<Accessibility> = Object.freeze({});
  #semantics: NormalizedAccessibility = normalizeAccessibility({});
  #accessibilityParent: UiNode | null = null;

  /** Nodes are made with createView(), createText() and the like. */
  constructor(
    token: symbol,
    view: ViewLink,
    type: NodeType,
    element?: HTMLElement,
    overlay = false,
  ) {
    if (token !== CONSTRUCTING) {
      throw new TypeError(
        'Illegal constructor: use createView(), createText() and the like',
      );
    }
    super();
    this.#view = view;
    this.#type = type;
    this.#root = element !== undefined;
    this.#rootClass = !this.#root
      ? ''
      : overlay
        ? 'sd-root sd-overlay'
        : 'sd-root';
    const { tag, className } = ELEMENTS[type];
    this.#element =
      element ?? view.rootElement.ownerDocument.createElement(tag);
    this.#element.className = [className, this.#rootClass]
      .filter(Boolean)
      .join(' ');
    if (type === 'image') {
      const image = this.#element as HTMLImageElement;
      image.alt = '';
      image.draggable = false;
    }
    if (type === 'input') {
      const input = this.#element as HTMLInputElement;
      input.type = 'text';
      input.spellcheck = false;
      input.autocomplete = 'off';
      input.tabIndex = -1;
      this.#focusable = true;
    }
    nodes.set(this.#element, this);
  }

  /** 'view', 'text', 'image', 'scroll' or 'input'. */
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
  get style(): Readonly<Style> {
    return this.#style;
  }

  set style(value: Readonly<Style>) {
    const style = readStyle(value);
    this.#element.style.cssText = cssText(cssFor(style, this.#type));
    const { className } = ELEMENTS[this.#type];
    this.#element.className = [className, this.#rootClass, pointerClass(style)]
      .filter(Boolean)
      .join(' ');
    this.#style = Object.freeze({ ...style });
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
    if (this.#type === 'input') this.#input().value = text;
    else this.#element.textContent = text;
    this.#text = text;
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
    if (isAssetId(this.#source)) {
      image.src = new URL(
        `${ASSET_PATH}/${this.#source}`,
        image.ownerDocument.baseURI,
      ).href;
    } else image.removeAttribute('src');
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
    return this.#element.scrollWidth;
  }

  get scrollHeight(): number {
    return this.#element.scrollHeight;
  }

  /** scrollTo({ top, left }) or scrollTo(left, top); clamped to the content. */
  scrollTo(
    optionsOrLeft?: { top?: number; left?: number } | number,
    top?: number,
  ): void {
    this.#expect('scroll', 'scrollTo()');
    const element = this.#element;
    const target =
      typeof optionsOrLeft === 'object' && optionsOrLeft !== null
        ? {
            x: optionsOrLeft.left ?? element.scrollLeft,
            y: optionsOrLeft.top ?? element.scrollTop,
          }
        : {
            x: optionsOrLeft ?? element.scrollLeft,
            y: top ?? element.scrollTop,
          };
    element.scrollLeft = Number(target.x) || 0;
    element.scrollTop = Number(target.y) || 0;
  }

  scrollBy(
    optionsOrLeft?: { top?: number; left?: number } | number,
    top?: number,
  ): void {
    const element = this.#element;
    const delta =
      typeof optionsOrLeft === 'object' && optionsOrLeft !== null
        ? { x: optionsOrLeft.left ?? 0, y: optionsOrLeft.top ?? 0 }
        : { x: optionsOrLeft ?? 0, y: top ?? 0 };
    this.scrollTo(
      element.scrollLeft + Number(delta.x),
      element.scrollTop + Number(delta.y),
    );
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

  get focused(): boolean {
    return this.#view.focusedNode() === this;
  }

  focus(): void {
    this.#view.focus(this);
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
    if (this.#type !== 'view' && this.#type !== 'scroll') {
      throw new Error('only views can have children');
    }
    if (child.contains(this)) throw new Error('a node cannot contain itself');
    if (before && before.#parent !== this) {
      throw new Error('the reference node is not a child of this node');
    }
    if (child === before) return child;
    if (child.#parent !== null) {
      const siblings = child.#parent.#children;
      siblings.splice(siblings.indexOf(child), 1);
    }
    const index = before ? this.#children.indexOf(before) : -1;
    if (index < 0) this.#children.push(child);
    else this.#children.splice(index, 0, child);
    child.#parent = this;
    this.#element.insertBefore(child.#element, before ? before.#element : null);
    this.#view.semanticsChanged();
    return child;
  }

  removeChild<T extends UiNode>(child: T): T {
    expectNode(child, 'child');
    if (child.#parent !== this) {
      throw new Error('the node is not a child of this node');
    }
    this.#children.splice(this.#children.indexOf(child), 1);
    child.#parent = null;
    child.#element.remove();
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
    const box = this.#rect();
    const scale = this.#view.scale();
    const width = box.width / scale;
    const height = box.height / scale;
    if (this.#parent === null) return { x: 0, y: 0, width, height };
    const parent = this.#parent.#rect();
    const scrolled = this.#parent.#element;
    return {
      x: (box.left - parent.left) / scale + scrolled.scrollLeft,
      y: (box.top - parent.top) / scale + scrolled.scrollTop,
      width,
      height,
    };
  }

  /** The laid-out box relative to the view (zero when not connected). */
  getBoundingClientRect(): LayoutRect {
    if (!this.isConnected) return ZERO;
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
  static elementOf(node: UiNode): HTMLElement {
    return node.#element;
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
  element?: HTMLElement,
  overlay = false,
): UiNode {
  return new UiNode(CONSTRUCTING, view, type, element, overlay);
}
