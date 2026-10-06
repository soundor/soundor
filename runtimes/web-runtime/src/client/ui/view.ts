/**
 * The plugin view in the browser: the root node's element, focus, and the
 * routing of the browser's input to Soundor events.
 *
 * Input follows the JUCE runtime's Surface rule for rule, so plugin UIs
 * behave alike in both: a pressed pointer is captured by its target until
 * the last button is up; hover enters and leaves along the tree; a click
 * goes to the deepest node holding both press and release; pressing moves
 * focus to the nearest focusable node; Tab cycles focusable nodes; the
 * wheel scrolls the nearest scroll view that can; the secondary button
 * asks for a context menu (`contextmenu`). Hit testing is the
 * browser's (it honors `pointerEvents`), and text inputs edit natively.
 */

import {
  FocusEvent,
  InputEvent,
  KeyboardEvent,
  PointerEvent,
  WheelEvent,
} from './events';
import { createNode, nodeOf, UiNode, type ViewLink } from './node';
import { STYLESHEET } from './style';

/** Pixels a wheel line scrolls, as in the JUCE runtime and browsers. */
const PIXELS_PER_LINE = 40;

const STYLE_ID = 'soundor-ui-style';

interface PointerState {
  captured: UiNode | null;
  hovered: UiNode[];
}

const elementOf = (node: UiNode): HTMLElement => UiNode.elementOf(node);

export class UiView implements ViewLink {
  /** The view's element: the surface both roots fill, and take input on. */
  readonly rootElement: HTMLElement;
  /** The content. */
  readonly root: UiNode;
  /** The overlay layer: over all of the content, and hit before it. */
  readonly overlay: UiNode;
  readonly #pointers = new Map<number, PointerState>();
  readonly #committed = new WeakMap<UiNode, string>();
  readonly #controller = new AbortController();
  #focused: UiNode | null = null;
  /** Set while the view moves DOM focus itself. */
  #movingFocus = false;
  /** Whether the last pointerdown kept the browser's default (focus, caret). */
  #nativeDown = false;
  #clipboard = '';

  constructor(document: Document = globalThis.document) {
    if (document.getElementById(STYLE_ID) === null) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = STYLESHEET;
      document.head.append(style);
    }
    this.rootElement = document.createElement('div');
    this.rootElement.className = 'sd-surface';
    this.rootElement.tabIndex = -1;
    this.rootElement.style.touchAction = 'none';
    this.root = createNode(this, 'view', document.createElement('div'));
    this.overlay = createNode(
      this,
      'view',
      document.createElement('div'),
      true,
    );
    this.rootElement.append(elementOf(this.root), elementOf(this.overlay));
    this.#listen();
  }

  /** Shows the view in `container` (the host's plugin viewport). */
  mount(container: HTMLElement): void {
    container.append(this.rootElement);
  }

  /** Detaches the view and its input listeners. */
  dispose(): void {
    this.#controller.abort();
    this.rootElement.remove();
  }

  createNode(type: 'view' | 'text' | 'image' | 'scroll' | 'input'): UiNode {
    return createNode(this, type);
  }

  /** CSS pixels per logical pixel: the host may scale the viewport. */
  scale(): number {
    const width = this.rootElement.offsetWidth;
    if (width === 0) return 1;
    return this.rootElement.getBoundingClientRect().width / width || 1;
  }

  /** The view's size in logical pixels, and device pixels per logical pixel. */
  size(): { width: number; height: number; scale: number } {
    const window = this.rootElement.ownerDocument.defaultView;
    return {
      width: this.rootElement.offsetWidth,
      height: this.rootElement.offsetHeight,
      scale: (window?.devicePixelRatio ?? 1) * this.scale(),
    };
  }

  // ── Focus ──────────────────────────────────────────────────────────────────

  focusedNode(): UiNode | null {
    if (this.#focused !== null && !this.#focused.isConnected)
      this.#focused = null;
    return this.#focused;
  }

  /**
   * Moves focus to `node` (or nowhere), firing blur then focus. A node that
   * is not focusable or not in the tree is ignored.
   */
  focus(node: UiNode | null, moveDomFocus = true): void {
    if (node !== null && (!node.focusable || !node.isConnected)) return;
    const previous = this.focusedNode();
    if (previous === node) return;
    this.#focused = node;
    if (moveDomFocus) {
      this.#movingFocus = true;
      try {
        // The view keeps the keyboard when no node has focus.
        (node === null ? this.rootElement : elementOf(node)).focus({
          preventScroll: true,
        });
      } finally {
        this.#movingFocus = false;
      }
    }
    if (previous !== null) {
      previous.dispatchEvent(
        new FocusEvent('blur', { composed: true, relatedTarget: node }),
      );
      if (previous.type === 'input') this.#commit(previous);
    }
    if (node !== null && this.#focused === node && node.isConnected) {
      if (node.type === 'input' && !this.#committed.has(node))
        this.#committed.set(node, node.value);
      node.dispatchEvent(
        new FocusEvent('focus', { composed: true, relatedTarget: previous }),
      );
    }
  }

  #moveFocus(backwards: boolean): boolean {
    const order: UiNode[] = [];
    const collect = (node: UiNode): void => {
      if (node.style.display === 'none') return;
      if (node.focusable) order.push(node);
      for (const child of node.children) collect(child);
    };
    collect(this.root);
    collect(this.overlay);
    if (order.length === 0) return false;
    const index = order.indexOf(this.focusedNode()!);
    const next =
      index < 0
        ? backwards
          ? order.length - 1
          : 0
        : (index + (backwards ? order.length - 1 : 1)) % order.length;
    this.focus(order[next]!);
    return true;
  }

  /** An input's `change`: its value differs from when it last reported. */
  #commit(input: UiNode): void {
    if (this.#committed.get(input) === input.value) return;
    this.#committed.set(input, input.value);
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  // ── Clipboard ──────────────────────────────────────────────────────────────

  /** The system clipboard where the page may use it, else the page's own. */
  async readClipboard(): Promise<string> {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return this.#clipboard;
    }
  }

  async writeClipboard(text: string): Promise<void> {
    this.#clipboard = text;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Not allowed here (an iframe, an insecure page): the page keeps it.
    }
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  #listen(): void {
    const element = this.rootElement;
    const options = { signal: this.#controller.signal };
    element.addEventListener(
      'pointerdown',
      (e) => this.#pointerDown(e),
      options,
    );
    element.addEventListener(
      'pointermove',
      (e) => this.#pointerMove(e),
      options,
    );
    element.addEventListener('pointerup', (e) => this.#pointerUp(e), options);
    element.addEventListener(
      'pointercancel',
      (e) => this.#pointerCancel(e),
      options,
    );
    element.addEventListener(
      'pointerleave',
      (e) => this.#pointerLeave(e),
      options,
    );
    // The browser's own press handling (focus, text selection) is the
    // view's, except placing the caret in a text input.
    element.addEventListener(
      'mousedown',
      (e) => {
        if (!this.#nativeDown) e.preventDefault();
      },
      options,
    );
    element.addEventListener('click', (e) => e.stopPropagation(), options);
    element.addEventListener(
      'contextmenu',
      (e) => this.#contextMenu(e),
      options,
    );
    element.addEventListener('wheel', (e) => this.#wheel(e), {
      ...options,
      passive: false,
    });
    element.addEventListener('keydown', (e) => this.#key(e, true), options);
    element.addEventListener('keyup', (e) => this.#key(e, false), options);
    element.addEventListener(
      'beforeinput',
      (e) => this.#beforeInput(e),
      options,
    );
    element.addEventListener('input', (e) => this.#input(e), options);
    element.addEventListener('change', (e) => e.stopPropagation(), options);
    element.addEventListener('focusin', (e) => this.#focusIn(e), options);
    element.addEventListener('focusout', (e) => this.#focusOut(e), options);
  }

  #hitTest(event: MouseEvent): UiNode | null {
    const document = this.rootElement.ownerDocument;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    if (hit === null || !this.rootElement.contains(hit)) return null;
    return nodeOf(hit, this.rootElement);
  }

  #pathTo(node: UiNode | null): UiNode[] {
    const path: UiNode[] = [];
    for (let at = node; at !== null; at = at.parent) path.unshift(at);
    return path;
  }

  #pointerEvent(
    type: string,
    target: UiNode,
    event: MouseEvent,
    bubbles: boolean,
    cancelable: boolean,
    relatedTarget: UiNode | null = null,
  ): PointerEvent {
    const root = this.rootElement.getBoundingClientRect();
    const scale = this.scale();
    const x = (event.clientX - root.left) / scale;
    const y = (event.clientY - root.top) / scale;
    const box = target.getBoundingClientRect();
    const pointer = event as globalThis.PointerEvent;
    return new PointerEvent(type, {
      bubbles,
      cancelable,
      composed: true,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      clientX: x,
      clientY: y,
      offsetX: x - box.x,
      offsetY: y - box.y,
      button: event.button,
      buttons: event.buttons,
      pointerId: pointer.pointerId ?? 1,
      pointerType: (pointer.pointerType ?? 'mouse') as 'mouse',
      pressure: pointer.pressure ?? (event.buttons !== 0 ? 0.5 : 0),
      isPrimary: true,
      relatedTarget,
    });
  }

  #state(pointerId: number): PointerState {
    let state = this.#pointers.get(pointerId);
    if (state === undefined) {
      state = { captured: null, hovered: [] };
      this.#pointers.set(pointerId, state);
    }
    if (state.captured !== null && !state.captured.isConnected)
      state.captured = null;
    return state;
  }

  #updateHover(state: PointerState, event: MouseEvent, target: UiNode | null) {
    const path = this.#pathTo(target);
    state.hovered = state.hovered.filter((node) => node.isConnected);
    let common = 0;
    while (
      common < path.length &&
      common < state.hovered.length &&
      path[common] === state.hovered[common]
    )
      ++common;
    const left = state.hovered.slice(common);
    state.hovered = path;
    // Leave from the innermost node out, enter from the outermost in.
    for (const node of [...left].reverse()) {
      node.dispatchEvent(
        this.#pointerEvent('pointerleave', node, event, false, false, target),
      );
    }
    for (let i = common; i < path.length; ++i) {
      const node = path[i]!;
      if (!node.isConnected) break;
      node.dispatchEvent(
        this.#pointerEvent(
          'pointerenter',
          node,
          event,
          false,
          false,
          left.at(-1) ?? null,
        ),
      );
    }
  }

  #pointerDown(event: globalThis.PointerEvent): void {
    const state = this.#state(event.pointerId);
    const hit = this.#hitTest(event);
    if (state.captured === null) this.#updateHover(state, event, hit);
    const target = state.captured ?? hit;
    this.#nativeDown = false;
    if (target === null) return;
    try {
      this.rootElement.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic or already released pointers cannot be captured.
    }
    const allowed = target.dispatchEvent(
      this.#pointerEvent('pointerdown', target, event, true, true),
    );
    if (state.captured === null && target.isConnected) state.captured = target;
    if (!allowed) {
      event.preventDefault();
      return;
    }
    // Focus goes to the nearest focusable node, or nowhere.
    let focusTarget: UiNode | null = null;
    for (let at: UiNode | null = target; at !== null; at = at.parent) {
      if (at.focusable) {
        focusTarget = at;
        break;
      }
    }
    // A text input keeps the browser's press, which places the caret.
    this.#nativeDown =
      focusTarget !== null && focusTarget === target && target.type === 'input';
    this.focus(focusTarget?.isConnected ? focusTarget : null);
  }

  #pointerMove(event: globalThis.PointerEvent): void {
    const state = this.#state(event.pointerId);
    const hit = this.#hitTest(event);
    const target = state.captured ?? hit;
    if (state.captured === null) this.#updateHover(state, event, hit);
    if (target === null) return;
    const allowed = target.dispatchEvent(
      this.#pointerEvent('pointermove', target, event, true, true),
    );
    if (!allowed) event.preventDefault();
  }

  #pointerUp(event: globalThis.PointerEvent): void {
    const state = this.#state(event.pointerId);
    const pressed = state.captured;
    const hit = this.#hitTest(event);
    const target = pressed ?? hit;
    if (target !== null) {
      target.dispatchEvent(
        this.#pointerEvent('pointerup', target, event, true, true),
      );
    }
    if (event.buttons !== 0) return;
    state.captured = null;
    try {
      this.rootElement.releasePointerCapture(event.pointerId);
    } catch {
      // Not captured.
    }
    // A click goes to the deepest node holding both press and release.
    const released = this.#hitTest(event);
    if (event.button === 0 && pressed !== null && released !== null) {
      const from = this.#pathTo(pressed);
      const to = this.#pathTo(released);
      let common: UiNode | null = null;
      for (
        let i = 0;
        i < from.length && i < to.length && from[i] === to[i];
        ++i
      )
        common = from[i]!;
      if (common !== null) {
        common.dispatchEvent(
          this.#pointerEvent('click', common, event, true, true),
        );
      }
    }
    this.#updateHover(state, event, this.#hitTest(event));
  }

  /**
   * The browser's request for a context menu (the secondary button, a long
   * touch) as a Soundor `contextmenu` at the pressed node, or the node under
   * the pointer. Preventing it keeps the browser's own menu away.
   */
  #contextMenu(event: MouseEvent): void {
    event.stopPropagation();
    const pointerId = (event as globalThis.PointerEvent).pointerId ?? 1;
    const captured = this.#pointers.get(pointerId)?.captured ?? null;
    const target =
      (captured?.isConnected ? captured : null) ?? this.#hitTest(event);
    if (target === null) return;
    const allowed = target.dispatchEvent(
      this.#pointerEvent('contextmenu', target, event, true, true),
    );
    if (!allowed) event.preventDefault();
  }

  #pointerCancel(event: globalThis.PointerEvent): void {
    const state = this.#state(event.pointerId);
    const target = state.captured;
    state.captured = null;
    if (target !== null) {
      target.dispatchEvent(
        this.#pointerEvent('pointercancel', target, event, true, false),
      );
    }
    this.#updateHover(state, event, null);
    this.#pointers.delete(event.pointerId);
  }

  #pointerLeave(event: globalThis.PointerEvent): void {
    const state = this.#state(event.pointerId);
    if (state.captured === null) this.#updateHover(state, event, null);
  }

  #wheel(event: globalThis.WheelEvent): void {
    const target = this.#hitTest(event);
    if (target === null) return;
    const base = this.#pointerEvent('wheel', target, event, true, true);
    const wheel = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      composed: true,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      clientX: base.clientX,
      clientY: base.clientY,
      offsetX: base.offsetX,
      offsetY: base.offsetY,
      buttons: event.buttons,
      pointerType: 'mouse',
      isPrimary: true,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode as 0 | 1 | 2,
    });
    if (!target.dispatchEvent(wheel)) {
      event.preventDefault();
      return;
    }
    // The default action: scroll the nearest scroll view that can.
    const unit =
      event.deltaMode === 1
        ? PIXELS_PER_LINE
        : event.deltaMode === 2
          ? this.rootElement.offsetHeight
          : 1;
    let deltaX = event.deltaX * unit;
    let deltaY = event.deltaY * unit;
    if (event.shiftKey && deltaX === 0) [deltaX, deltaY] = [deltaY, deltaX];
    if (this.#scrollBy(target, deltaX, deltaY)) event.preventDefault();
  }

  #scrollBy(target: UiNode, deltaX: number, deltaY: number): boolean {
    for (let node: UiNode | null = target; node !== null; node = node.parent) {
      if (node.type !== 'scroll' || node.style.display === 'none') continue;
      const before = { x: node.scrollLeft, y: node.scrollTop };
      node.scrollTo(before.x + deltaX, before.y + deltaY);
      if (node.scrollLeft === before.x && node.scrollTop === before.y) continue;
      node.dispatchEvent(new Event('scroll', { composed: true }));
      return true;
    }
    return false;
  }

  #key(event: globalThis.KeyboardEvent, down: boolean): void {
    if (event.isComposing) return;
    const target = this.focusedNode() ?? this.root;
    const allowed = target.dispatchEvent(
      new KeyboardEvent(down ? 'keydown' : 'keyup', {
        bubbles: true,
        cancelable: true,
        composed: true,
        key: event.key,
        repeat: event.repeat,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      }),
    );
    if (!allowed) {
      event.preventDefault();
      return;
    }
    if (!down) return;
    const shortcut = event.ctrlKey || event.altKey || event.metaKey;
    if (event.key === 'Tab' && !shortcut) {
      event.preventDefault();
      this.#moveFocus(event.shiftKey);
    } else if (event.key === 'Enter' && target.type === 'input') {
      this.#commit(target);
    }
  }

  #beforeInput(event: globalThis.InputEvent): void {
    const node = nodeOf(event.target as Element, this.rootElement);
    // Text arriving at an input; deletions and the like are its own edits.
    if (node?.type !== 'input' || !event.inputType.startsWith('insert')) return;
    if (event.data === null || event.data === '') return;
    const allowed = node.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        composed: true,
        data: event.data,
        inputType: 'insertText',
      }),
    );
    if (!allowed) event.preventDefault();
  }

  #input(event: Event): void {
    event.stopPropagation();
    const node = nodeOf(event.target as Element, this.rootElement);
    if (node?.type !== 'input') return;
    const native = event as globalThis.InputEvent;
    node.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        composed: true,
        data: native.data ?? null,
        inputType: native.inputType ?? 'insertText',
      }),
    );
  }

  /** Focus the browser moved itself (it should not, but stay in step). */
  #focusIn(event: globalThis.FocusEvent): void {
    if (this.#movingFocus) return;
    const node = nodeOf(event.target as Element, this.rootElement);
    if (node !== null && node.focusable && node !== this.focusedNode())
      this.focus(node, false);
  }

  /** Focus leaving the plugin (to the host page) blurs the focused node. */
  #focusOut(event: globalThis.FocusEvent): void {
    if (this.#movingFocus) return;
    const next = event.relatedTarget as Node | null;
    if (next !== null && this.rootElement.contains(next)) return;
    this.focus(null, false);
  }
}
