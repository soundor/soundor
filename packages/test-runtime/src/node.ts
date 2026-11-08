import { ease, TestAnimation } from './animation';
import type { TestRuntime } from './runtime';
/**
 * soundor:ui for tests in Node: the same tree semantics, kept in JavaScript,
 * with DOM-style capture and bubble dispatch. Plus helpers to fire events and
 * to print the tree.
 */
import { normalizeSvgScene } from './svg-scene';
import type { SvgScene } from './types';
import type {
  AnimationKeyframe,
  AnimationDescription,
  AnimationOptions,
} from './types';
import type { NodeType, Accessibility } from './types';

interface ListenerOptions {
  capture?: boolean;
  once?: boolean;
  passive?: boolean;
  signal?: AbortSignal;
}
type Listener = {
  call: (event: TestEvent) => void;
  capture: boolean;
  once: boolean;
  passive: boolean;
  signal?: AbortSignal;
};

export class TestEvent {
  target: TestNode | null = null;
  currentTarget: TestNode | null = null;
  defaultPrevented = false;
  stopped = false;
  immediateStopped = false;
  eventPhase = 0;
  cancelable = true;
  passive = false;
  path: TestNode[] = [];
  get timeStamp() {
    return this.target?.runtime.clock.now ?? 0;
  }
  getModifierState(key: string): boolean {
    return Boolean(
      this[
        {
          Shift: 'shiftKey',
          Control: 'ctrlKey',
          Alt: 'altKey',
          Meta: 'metaKey',
        }[key] ?? ''
      ],
    );
  }
  composedPath(): TestNode[] {
    return [...this.path];
  }
  stopImmediatePropagation() {
    this.immediateStopped = true;
    this.stopPropagation();
  }
  [key: string]: unknown;

  constructor(
    readonly type: string,
    init: Record<string, unknown> = {},
    readonly bubbles = true,
  ) {
    Object.assign(this, {
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      button: 0,
      buttons: 0,
      pointerId: 0,
      pointerType: '',
      movementX: 0,
      movementY: 0,
      isPrimary: false,
      pressure: 0,
      key: '',
      repeat: false,
      data: null,
      inputType: '',
      relatedTarget: null,
      focusVisible: false,
      ...init,
    });
    this['pageX'] = init['pageX'] ?? init['clientX'] ?? 0;
    this['pageY'] = init['pageY'] ?? init['clientY'] ?? 0;
    this['screenX'] = init['screenX'] ?? this['pageX'];
    this['screenY'] = init['screenY'] ?? this['pageY'];
    this['locationX'] = init['locationX'] ?? init['offsetX'] ?? 0;
    this['locationY'] = init['locationY'] ?? init['offsetY'] ?? 0;
  }

  preventDefault() {
    if (this.cancelable && !this.passive) this.defaultPrevented = true;
  }

  stopPropagation() {
    this.stopped = true;
  }
}

/**
 * Marks a node of the simulated runtime, whichever copy of this package made
 * it: a test and its environment may load different copies, where
 * `instanceof` says no.
 */
export const TEST_NODE = Symbol.for('soundor.test-node.v1');

/** How long a smooth scroll takes in the runtimes. */
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

/** Whether `value` is a node of the simulated runtime, from any copy. */
export function isTestNode(value: unknown): value is TestNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [TEST_NODE]?: unknown })[TEST_NODE] === true
  );
}

export class TestNode {
  /** On the prototype, so nodes print and spread as before. */
  get [TEST_NODE](): true {
    return true;
  }
  readonly id: number;
  get animations(): readonly TestAnimation[] {
    return this.runtime.animationsFor(this);
  }
  animate(
    frames: readonly AnimationKeyframe[] | AnimationDescription,
    options: AnimationOptions = {},
  ): TestAnimation {
    const animation = this.runtime.animate(this, frames, options);
    return animation;
  }
  get presentation(): Record<string, unknown> {
    return this.runtime.presentation(this);
  }
  parent: TestNode | null = null;
  readonly kids: TestNode[] = [];
  #style: Record<string, unknown> = {};
  /** Replacing it starts or stops scrolling, as the runtimes do. */
  get style(): Record<string, unknown> {
    return this.#style;
  }
  set style(value: Record<string, unknown>) {
    this.#style = value;
    // What no longer scrolls goes back to its start, and says so.
    const left = this.#scrolls('x') ? this.#scrollLeft : 0;
    const top = this.#scrolls('y') ? this.#scrollTop : 0;
    if (left === this.#scrollLeft && top === this.#scrollTop) return;
    this.#smooth = null;
    this.#scrollLeft = left;
    this.#scrollTop = top;
    this.runtime.scrolled(this);
  }
  text = '';
  placeholder = '';
  source = '';
  svgScene: SvgScene | null = null;
  svgSceneUpdates = 0;
  setSvgScene(scene: SvgScene | null): void {
    this.runtime.assertActive();
    if (this.type !== 'svg')
      throw new TypeError('setSvgScene() belongs to svg nodes');
    const next = scene === null ? null : normalizeSvgScene(scene);
    if (JSON.stringify(next) === JSON.stringify(this.svgScene)) return;
    this.svgScene = next;
    this.svgSceneUpdates++;
  }
  // Canvases.
  width = 300;
  height = 150;
  focusable: boolean;
  accessibility: Accessibility = {};
  accessibilityParent: TestNode | null = null;
  #debugId = '';
  readonly listeners = new Map<string, Listener[]>();

  constructor(
    readonly runtime: TestRuntime,
    readonly type: NodeType,
  ) {
    runtime.assertActive();
    this.id = runtime.nextId++;
    runtime.nodes.set(this.id, this);
    this.focusable = type === 'input';
  }

  /** The name developer tools find the node by; empty for none. */
  get debugId(): string {
    return this.#debugId;
  }

  set debugId(value: string) {
    const debugId = String(value ?? '');
    if (debugId.length > 128)
      throw new RangeError('debugId is at most 128 characters');
    this.#debugId = debugId;
  }

  get children(): readonly TestNode[] {
    return [...this.kids];
  }

  get isConnected(): boolean {
    if (this.runtime.isDisposed) return false;
    return (
      this === this.runtime.root ||
      this === this.runtime.overlayRoot ||
      (this.parent?.isConnected ?? false)
    );
  }

  get focused(): boolean {
    return this.runtime.focusedNode() === this;
  }

  /** It has focus and should show it, as in the JUCE runtime. */
  get focusVisible(): boolean {
    return this.focused && this.runtime.focusVisible();
  }

  focus() {
    this.runtime.moveFocus(this);
  }

  /** Locks the press of this node (or a node in it) to it; see soundor:ui. */
  requestPointerLock(): Promise<void> {
    return this.runtime.requestPointerLock(this);
  }

  blur() {
    if (this.focused) this.runtime.moveFocus(null);
  }

  get value(): string {
    return this.text;
  }

  set value(value: string) {
    this.text = value;
    this.selectionStart = this.selectionEnd = value.length;
  }

  selectionStart = 0;
  selectionEnd = 0;
  selectionDirection: 'forward' | 'backward' = 'forward';
  setSelectionRange(
    start: number,
    end: number,
    direction: 'forward' | 'backward' = 'forward',
  ) {
    this.selectionEnd = Math.max(0, Math.min(this.value.length, end));
    this.selectionStart = Math.max(0, Math.min(this.selectionEnd, start));
    this.selectionDirection = direction;
  }
  select() {
    this.setSelectionRange(0, this.value.length);
  }
  contains(other: TestNode | null): boolean {
    for (let at = other; at; at = at.parent) if (at === this) return true;
    return false;
  }
  get firstChild(): TestNode | null {
    return this.kids[0] ?? null;
  }
  get lastChild(): TestNode | null {
    return this.kids.at(-1) ?? null;
  }
  get nextSibling(): TestNode | null {
    return this.parent?.kids[this.parent.kids.indexOf(this) + 1] ?? null;
  }
  get previousSibling(): TestNode | null {
    return this.parent?.kids[this.parent.kids.indexOf(this) - 1] ?? null;
  }
  get layout(): never {
    throw new Error('Layout is unavailable in the simulated Soundor runtime');
  }
  getBoundingClientRect(): never {
    throw new Error('Layout is unavailable in the simulated Soundor runtime');
  }
  getContext(): null {
    return null;
  }
  #scrollTop = 0;
  #scrollLeft = 0;
  get scrollTop(): number {
    return this.#scrollTop;
  }
  set scrollTop(value: number) {
    this.scrollTo({ top: value });
  }
  get scrollLeft(): number {
    return this.#scrollLeft;
  }
  set scrollLeft(value: number) {
    this.scrollTo({ left: value });
  }
  /** Nothing is laid out here, so nothing shows, without asking what it would be. */
  readonly clientWidth: number = 0;
  readonly clientHeight: number = 0;
  scrollIndicators = true;
  get scrollWidth(): never {
    throw new Error('Layout is unavailable in the simulated Soundor runtime');
  }
  get scrollHeight(): never {
    throw new Error('Layout is unavailable in the simulated Soundor runtime');
  }
  /** Whether a view's style scrolls that axis (`overflowX`/`Y` over `overflow`). */
  #scrolls(axis: 'x' | 'y'): boolean {
    if (this.type !== 'view') return false;
    const own = axis === 'x' ? this.#style.overflowX : this.#style.overflowY;
    return (own ?? this.#style.overflow) === 'scroll';
  }
  /** A smooth scroll on its way: from, to, and when it started. */
  #smooth: {
    from: { left: number; top: number };
    to: { left: number; top: number };
    started: number;
  } | null = null;
  #moveTo(left: number, top: number) {
    if (left === this.#scrollLeft && top === this.#scrollTop) return;
    this.#scrollLeft = left;
    this.#scrollTop = top;
    this.runtime.scrolled(this);
  }
  /**
   * Along the axes its style scrolls; nothing on a node that does not, as in
   * the runtimes. Nothing is laid out here, so nothing clamps it but 0.
   * 'smooth' takes the runtimes' 300 ms on the virtual clock, eased in and
   * out, a step each frame.
   */
  scrollTo(
    options:
      | { top?: number; left?: number; behavior?: string }
      | number
      | undefined,
    top?: number,
  ) {
    const next =
      typeof options === 'object' && options !== null
        ? options
        : { left: options, top };
    const smooth = scrollBehavior((next as { behavior?: unknown }).behavior);
    const left = this.#scrolls('x')
      ? Math.max(0, Number(next.left ?? this.#scrollLeft) || 0)
      : 0;
    const down = this.#scrolls('y')
      ? Math.max(0, Number(next.top ?? this.#scrollTop) || 0)
      : 0;
    this.#smooth = null;
    if (!smooth || this.runtime.prefersReducedMotion()) {
      this.#moveTo(left, down);
      return;
    }
    if (left === this.#scrollLeft && down === this.#scrollTop) return;
    const scroll = {
      from: { left: this.#scrollLeft, top: this.#scrollTop },
      to: { left, top: down },
      started: this.runtime.clock.now,
    };
    this.#smooth = scroll;
    const step = () => {
      if (this.#smooth !== scroll) return;
      const progress = Math.min(
        1,
        (this.runtime.clock.now - scroll.started) / SMOOTH_SCROLL_MS,
      );
      const eased = ease('ease-in-out', progress);
      this.#moveTo(
        scroll.from.left + (scroll.to.left - scroll.from.left) * eased,
        scroll.from.top + (scroll.to.top - scroll.from.top) * eased,
      );
      if (progress >= 1) this.#smooth = null;
      else
        this.runtime.clock.setTimeout(
          step,
          this.runtime.clock.untilNextFrame(),
          true,
        );
    };
    this.runtime.clock.setTimeout(
      step,
      this.runtime.clock.untilNextFrame(),
      true,
    );
  }
  scrollBy(
    options:
      | { top?: number; left?: number; behavior?: string }
      | number
      | undefined,
    top?: number,
  ) {
    const next =
      typeof options === 'object' && options !== null
        ? options
        : { left: options, top };
    this.scrollTo({
      left: this.scrollLeft + (Number(next.left ?? 0) || 0),
      top: this.scrollTop + (Number(next.top ?? 0) || 0),
      behavior: (next as { behavior?: string }).behavior,
    });
  }
  /**
   * Nothing is laid out here, so nothing knows where it is: checks what it is
   * given, as the runtimes do, and moves nothing.
   */
  scrollIntoView(
    arg?: boolean | { block?: string; inline?: string; behavior?: string },
  ) {
    if (typeof arg !== 'object' || arg === null) return;
    for (const alignment of [arg.block, arg.inline])
      if (
        alignment !== undefined &&
        !['start', 'center', 'end', 'nearest'].includes(alignment)
      )
        throw new TypeError(
          `The provided value '${String(alignment)}' is not a valid enum value of type ScrollLogicalPosition.`,
        );
    scrollBehavior(arg.behavior);
  }

  appendChild(child: TestNode) {
    return this.insertBefore(child, null);
  }

  insertBefore(child: TestNode, before: TestNode | null) {
    if (
      this.type === 'text' ||
      this.type === 'image' ||
      this.type === 'input' ||
      this.type === 'svg'
    )
      throw new TypeError('only views can have children');
    this.runtime.assertActive();
    if (child.runtime !== this.runtime)
      throw new TypeError('node belongs to another runtime');
    if (child.contains(this))
      throw new TypeError('tree operation would create a cycle');
    if (before !== null && before.parent !== this)
      throw new TypeError('reference node is not a child');
    if (child === before) return child;
    child.parent?.detachChild(child);
    const index = before === null ? -1 : this.kids.indexOf(before);
    if (index < 0) this.kids.push(child);
    else this.kids.splice(index, 0, child);
    child.parent = this;
    return child;
  }

  private detachChild(child: TestNode) {
    const index = this.kids.indexOf(child);
    if (index < 0) throw new TypeError('node is not a child');
    this.kids.splice(index, 1);
    child.parent = null;
    return child;
  }

  removeChild(child: TestNode) {
    this.runtime.assertNode(child);
    if (child.parent !== this) throw new TypeError('node is not a child');
    this.detachChild(child);
    this.runtime.detachAnimations(child);
    return child;
  }
  remove() {
    this.parent?.removeChild(this);
  }

  addEventListener(
    type: string,
    call: (event: TestEvent) => void,
    options?: boolean | ListenerOptions,
  ) {
    this.runtime.assertActive();
    const opts =
      typeof options === 'boolean' ? { capture: options } : (options ?? {});
    if (opts.signal?.aborted) return;
    const list = this.listeners.get(type) ?? [];
    if (
      list.some(
        (entry) =>
          entry.call === call && entry.capture === Boolean(opts.capture),
      )
    )
      return;
    list.push({
      call,
      capture: Boolean(opts.capture),
      once: Boolean(opts.once),
      passive: Boolean(opts.passive),
      signal: opts.signal,
    });
    opts.signal?.addEventListener(
      'abort',
      () => this.removeEventListener(type, call, opts.capture),
      { once: true },
    );
    this.listeners.set(type, list);
  }

  removeEventListener(
    type: string,
    call: (event: TestEvent) => void,
    options?: boolean | ListenerOptions,
  ) {
    const capture =
      typeof options === 'boolean' ? options : Boolean(options?.capture);
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((entry) => entry.call !== call || entry.capture !== capture),
    );
  }

  dispatchEvent(event: TestEvent): boolean {
    this.runtime.assertActive();
    if (event.eventPhase !== 0)
      throw new DOMException(
        'The event is already being dispatched',
        'InvalidStateError',
      );
    event.stopped = false;
    event.immediateStopped = false;
    const path: TestNode[] = [];
    for (let node: TestNode | null = this; node; node = node.parent)
      path.push(node);
    event.target = this;
    event.path = path;
    const run = (node: TestNode, capture: boolean | null) => {
      event.currentTarget = node;
      event.eventPhase = node === this ? 2 : capture ? 1 : 3;
      for (const entry of [...(node.listeners.get(event.type) ?? [])]) {
        if (event.immediateStopped) break;
        if (
          entry.signal?.aborted ||
          !(node.listeners.get(event.type) ?? []).includes(entry)
        )
          continue;
        if (capture === null || entry.capture === capture) {
          if (entry.once)
            node.removeEventListener(event.type, entry.call, entry.capture);
          event.passive = entry.passive;
          try {
            entry.call.call(node, event);
          } finally {
            event.passive = false;
          }
        }
      }
    };
    try {
      for (let i = path.length - 1; i > 0 && !event.stopped; --i)
        run(path[i]!, true);
      if (!event.stopped) {
        run(this, true);
        if (!event.immediateStopped) run(this, false);
      }
      if (event.bubbles)
        for (let i = 1; i < path.length && !event.stopped; ++i)
          run(path[i]!, false);
    } finally {
      event.currentTarget = null;
      event.eventPhase = 0;
      event.path = [];
    }
    if (!event.defaultPrevented) this.runtime.defaultAction(this, event);
    return !event.defaultPrevented;
  }
}

/** Dispatches an event at `node`; returns it. */
export function fire(
  node: TestNode,
  type: string,
  init: Record<string, unknown> = {},
) {
  const event = new TestEvent(
    type,
    init,
    !['focus', 'blur', 'focusvisiblechange', 'scroll'].includes(type),
  );
  node.dispatchEvent(event);
  return event;
}

/** The tree as text: `view{flex:1}[text"Hi"]`. */
export function print(node: TestNode): string {
  const style = Object.entries(node.style)
    .map(([key, value]) => `${key}:${String(value)}`)
    .join(',');
  let out = node.type + (style ? `{${style}}` : '');
  if (node.type === 'text' || node.type === 'input')
    out += JSON.stringify(node.text);
  if (node.type === 'image') out += `<${node.source}>`;
  if (node.kids.length > 0)
    out += `[${node.kids.map((kid) => print(kid)).join(' ')}]`;
  return out;
}
