/**
 * soundor:ui for tests in Node: the same tree semantics, kept in JavaScript,
 * with DOM-style capture and bubble dispatch. Plus helpers to fire events and
 * to print the tree.
 */

import { TestAnimation } from './animation';
import type { TestRuntime } from './runtime';
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
      ...init,
    });
    this['pageX'] = init['pageX'] ?? init['clientX'] ?? 0;
    this['pageY'] = init['pageY'] ?? init['clientY'] ?? 0;
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

export class TestNode {
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
  style: Record<string, unknown> = {};
  text = '';
  placeholder = '';
  source = '';
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
  scrollTop = 0;
  scrollLeft = 0;
  get scrollWidth(): never {
    throw new Error('Layout is unavailable in the simulated Soundor runtime');
  }
  get scrollHeight(): never {
    throw new Error('Layout is unavailable in the simulated Soundor runtime');
  }
  scrollTo(options: { top?: number; left?: number } | number, top?: number) {
    const next = typeof options === 'number' ? { left: options, top } : options;
    if (next.left !== undefined) this.scrollLeft = Math.max(0, next.left);
    if (next.top !== undefined) this.scrollTop = Math.max(0, next.top);
    this.runtime.fire(this, 'scroll');
  }
  scrollBy(options: { top?: number; left?: number } | number, top?: number) {
    const next = typeof options === 'number' ? { left: options, top } : options;
    this.scrollTo({
      left: this.scrollLeft + (next.left ?? 0),
      top: this.scrollTop + (next.top ?? 0),
    });
  }

  appendChild(child: TestNode) {
    return this.insertBefore(child, null);
  }

  insertBefore(child: TestNode, before: TestNode | null) {
    if (this.type === 'text' || this.type === 'image' || this.type === 'input')
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
    !['focus', 'blur', 'scroll'].includes(type),
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
