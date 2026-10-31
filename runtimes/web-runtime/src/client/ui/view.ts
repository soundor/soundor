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

import { Listeners } from '../listeners';
import { AnimationController } from './animation';
import {
  AccessibilityActionEvent,
  FocusEvent,
  InputEvent,
  KeyboardEvent,
  PointerEvent,
  WheelEvent,
} from './events';
import { createNode, nodeOf, UiNode, type ViewLink } from './node';
import { updateSemantics } from './semantics';
import { STYLESHEET } from './style';
import type { Cursor, NodeType, ViewSize } from './types';

/** Pixels a wheel line scrolls, as in the JUCE runtime and browsers. */
const PIXELS_PER_LINE = 40;

const STYLE_ID = 'soundor-ui-style';

interface PointerState {
  captured: UiNode | null;
  hovered: UiNode[];
  /** The last input, where hover is refreshed from. */
  last: globalThis.PointerEvent | null;
  /** In the view, as of the last input. */
  inside: boolean;
}

const elementOf = (node: UiNode): HTMLElement => UiNode.elementOf(node);

export class UiView implements ViewLink {
  readonly animations: AnimationController;
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
  /** Whether the ARIA is to be brought up to date. */
  #semanticsPending = false;
  /** The pointer whose cursor shows (the mouse), and the cursor shown. */
  #cursorPointer = 1;
  #cursor: Cursor = 'default';
  /** The node holding the pointer lock, and the pointer it holds. */
  #lock: { node: UiNode; pointerId: number } | null = null;
  /** The frame hover is to be refreshed in, if any. */
  #hoverFrame: number | null = null;
  #resizes: ResizeObserver | null = null;
  /** The latest size(); replaced (never changed) when the size changes. */
  #size: ViewSize = Object.freeze({ width: 0, height: 0, scale: 1 });
  readonly #sizeListeners = new Listeners<ViewSize>();

  constructor(document: Document = globalThis.document) {
    this.animations = new AnimationController(document.defaultView);
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
    this.animations.dispose();
    this.#resizes?.disconnect();
    this.#sizeListeners.clear();
    if (this.#hoverFrame !== null)
      this.rootElement.ownerDocument.defaultView?.cancelAnimationFrame(
        this.#hoverFrame,
      );
    this.#controller.abort();
    this.rootElement.remove();
  }

  createNode(type: NodeType): UiNode {
    return createNode(this, type);
  }

  /** CSS pixels per logical pixel: the host may scale the viewport. */
  scale(): number {
    const width = this.rootElement.offsetWidth;
    if (width === 0) return 1;
    return this.rootElement.getBoundingClientRect().width / width || 1;
  }

  /**
   * The view's size in logical pixels, and device pixels per logical pixel:
   * measured, but the same frozen object until one of them changes.
   */
  size(): ViewSize {
    const window = this.rootElement.ownerDocument.defaultView;
    const width = this.rootElement.offsetWidth;
    const height = this.rootElement.offsetHeight;
    const scale = (window?.devicePixelRatio ?? 1) * this.scale();
    const size = this.#size;
    if (
      width !== size.width ||
      height !== size.height ||
      scale !== size.scale
    ) {
      this.#size = Object.freeze({ width, height, scale });
    }
    return this.#size;
  }

  /**
   * Calls `listener` with the new size() whenever the view's size or scale
   * changes. Returns a function that unsubscribes.
   */
  subscribeSize(listener: (size: ViewSize) => void): () => void {
    return this.#sizeListeners.add(listener, 'subscribeViewSize()');
  }

  /**
   * Measures the view again and tells subscribers if it changed: the view
   * does on a resize or a new pixel density; the host calls it when it
   * scales the view, which no observer sees.
   */
  measure(): void {
    const previous = this.#size;
    const size = this.size();
    if (size !== previous) this.#sizeListeners.notify(size);
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

  // ── Accessibility ──────────────────────────────────────────────────────────

  /** Brings the ARIA up to date once the current task's changes are done. */
  semanticsChanged(): void {
    if (this.#semanticsPending) return;
    this.#semanticsPending = true;
    queueMicrotask(() => this.updateSemantics());
  }

  /** Sets the view's ARIA to match its nodes now. */
  updateSemantics(): void {
    this.#semanticsPending = false;
    updateSemantics([this.root, this.overlay]);
    // The tree or a style changed, so the cursor may have too, and what is
    // under a pointer once the browser lays it out.
    this.#updateCursor();
    this.#hoverChanged();
  }

  // ── Pointer lock ─────────────────────────────────────────────────────────

  /**
   * Locks the mouse or pen pressing `node` (or a node in it) to `node`, as
   * the JUCE runtime does: the browser locks the view's element, which gets
   * every move, and the view routes them to `node`.
   */
  requestPointerLock(node: UiNode): Promise<void> {
    const element = this.rootElement;
    const document = element.ownerDocument;
    const pressing = [...this.#pointers].find(
      ([, state]) =>
        state.captured !== null &&
        state.last?.pointerType !== 'touch' &&
        node.contains(state.captured),
    );
    if (pressing === undefined || !node.isConnected) {
      return Promise.reject(
        new DOMException(
          'requestPointerLock(): no press of this node to lock',
          'NotAllowedError',
        ),
      );
    }
    const [pointerId, state] = pressing;
    state.captured = node;
    this.#lock = { node, pointerId };
    if (document.pointerLockElement === element) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const settle = (locked: boolean) => {
        document.removeEventListener('pointerlockchange', changed);
        document.removeEventListener('pointerlockerror', refused);
        if (locked) return resolve();
        if (this.#lock?.node === node) this.#lock = null;
        reject(
          new DOMException(
            'requestPointerLock(): the browser refused the lock',
            'NotAllowedError',
          ),
        );
      };
      const changed = () => settle(document.pointerLockElement === element);
      const refused = () => settle(false);
      document.addEventListener('pointerlockchange', changed);
      document.addEventListener('pointerlockerror', refused);
      try {
        // A promise in current browsers, nothing in older ones (the events
        // say how it went then).
        const result = element.requestPointerLock() as unknown;
        if (result instanceof Promise) result.catch(refused);
      } catch {
        refused();
      }
    });
  }

  /** Ends the pointer lock, if any: the pointer shows again where it began. */
  exitPointerLock(): void {
    this.#endLock();
  }

  /** The node holding the pointer lock, if any. */
  pointerLockNode(): UiNode | null {
    const lock = this.#lock;
    if (lock === null) return null;
    if (
      !lock.node.isConnected ||
      this.#pointers.get(lock.pointerId)?.captured !== lock.node
    ) {
      this.#endLock();
      return null;
    }
    return lock.node;
  }

  /** Ends the lock (of `pointerId` only, when given). */
  #endLock(pointerId?: number): void {
    if (pointerId !== undefined && this.#lock?.pointerId !== pointerId) {
      // A lock its node let go of (removed) still ends with the press.
      if (this.#lock !== null) return;
    }
    this.#lock = null;
    const document = this.rootElement.ownerDocument;
    if (document.pointerLockElement === this.rootElement)
      document.exitPointerLock();
  }

  /** Refreshes hover in the next frame, once. */
  /**
   * Measures the view again when the page's pixel density changes (browser
   * zoom, a display of another density), which resizes nothing an observer
   * sees. A media query matches one density: a new one is made each time.
   */
  #watchDensity(): void {
    const window = this.rootElement.ownerDocument.defaultView;
    if (typeof window?.matchMedia !== 'function') return;
    const query = window.matchMedia(
      `(resolution: ${window.devicePixelRatio}dppx)`,
    );
    query.addEventListener(
      'change',
      () => {
        this.measure();
        this.#watchDensity();
      },
      { once: true, signal: this.#controller.signal },
    );
  }

  #hoverChanged(): void {
    const window = this.rootElement.ownerDocument.defaultView;
    if (this.#hoverFrame !== null || window === null) return;
    this.#hoverFrame = window.requestAnimationFrame(() => {
      this.#hoverFrame = null;
      this.refreshHover();
    });
  }

  /**
   * Hover follows what changed under pointers that did not move, as in
   * browsers and the JUCE runtime: each mouse or pen in the view and not
   * pressed is hit-tested again where it is, and pointerleave/pointerenter
   * fire as for a move (no pointermove).
   */
  refreshHover(): void {
    for (const state of [...this.#pointers.values()]) {
      const last = state.last;
      if (last === null || !state.inside || state.captured !== null) continue;
      if (last.pointerType === 'touch') continue;
      const hit = this.#hitTest(last);
      const path = this.#pathTo(hit);
      const hovered = state.hovered.filter((node) => node.isConnected);
      if (
        path.length === hovered.length &&
        path.every((node, i) => node === hovered[i])
      )
        continue;
      this.#updateHover(state, last, hit);
    }
    this.#updateCursor();
  }

  /**
   * The cursor the mouse shows, as in the JUCE runtime: the style's of the
   * node holding the pointer, or else of the deepest it hovers, or of their
   * nearest ancestor with one; a text input's 'text', and the arrow where
   * none has one.
   */
  cursor(): Exclude<Cursor, 'auto'> {
    const state = this.#pointers.get(this.#cursorPointer);
    let node: UiNode | null = null;
    if (state?.captured?.isConnected) node = state.captured;
    else node = state?.hovered.findLast((at) => at.isConnected) ?? null;
    for (; node !== null; node = node.parent) {
      const cursor = node.style.cursor ?? 'auto';
      if (cursor !== 'auto') return cursor;
      if (node.type === 'input') return 'text';
    }
    return 'default';
  }

  /** Shows cursor() over the view: every node's element inherits it. */
  #updateCursor(): void {
    const cursor = this.cursor();
    if (cursor === this.#cursor) return;
    this.#cursor = cursor;
    this.rootElement.style.cursor = cursor;
  }

  /**
   * A click no pointer made (detail 0): assistive technology activating an
   * element. It becomes the `activate` accessibility action of the nearest
   * element offering one, as natively. Pointer clicks are the view's own,
   * from its press and release, so a press is never delivered twice; and
   * what the browser does natively (focusing an input) stays the browser's.
   */
  #click(event: MouseEvent): void {
    event.stopPropagation();
    if (event.detail !== 0) return;
    for (
      let node = nodeOf(event.target as Element | null, this.rootElement);
      node !== null;
      node = node.parent
    ) {
      const { actions, state } = UiNode.semanticsOf(node);
      if (!actions.some((action) => action.name === 'activate')) continue;
      if (state.disabled) return;
      const action = new AccessibilityActionEvent('accessibilityaction', {
        bubbles: true,
        cancelable: true,
        composed: true,
        actionName: 'activate',
      });
      if (!node.dispatchEvent(action)) event.preventDefault();
      return;
    }
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
    // After the UI handles a mouse's (or pen's) input, its cursor.
    const pointer =
      (handle: (event: globalThis.PointerEvent) => void) =>
      (event: globalThis.PointerEvent) => {
        // Known while the UI handles it (requestPointerLock() reads its type).
        const state = this.#state(event.pointerId);
        state.last = event;
        state.inside = event.type !== 'pointerleave';
        handle(event);
        if (event.pointerType !== 'touch')
          this.#cursorPointer = event.pointerId;
        this.#updateCursor();
      };
    element.addEventListener(
      'pointerdown',
      pointer((e) => this.#pointerDown(e)),
      options,
    );
    element.addEventListener(
      'pointermove',
      pointer((e) => this.#pointerMove(e)),
      options,
    );
    element.addEventListener(
      'pointerup',
      pointer((e) => this.#pointerUp(e)),
      options,
    );
    element.addEventListener(
      'pointercancel',
      pointer((e) => this.#pointerCancel(e)),
      options,
    );
    element.addEventListener(
      'pointerleave',
      pointer((e) => this.#pointerLeave(e)),
      options,
    );
    // A resized view lays out again under the pointer, and tells its size
    // subscribers (measured after layout, before the frame is painted).
    const Observer = element.ownerDocument.defaultView?.ResizeObserver;
    if (Observer !== undefined) {
      this.#resizes = new Observer(() => {
        this.#hoverChanged();
        this.measure();
      });
      this.#resizes.observe(element);
    }
    this.#watchDensity();
    // A press the view did not capture (a text input's) can move and end
    // outside it; inside, the view's own listeners have it.
    const window = element.ownerDocument.defaultView;
    const outside =
      (handle: (event: globalThis.PointerEvent) => void) =>
      (event: globalThis.PointerEvent) => {
        if (element.contains(event.target as Node | null)) return;
        if (this.#pointers.get(event.pointerId)?.captured == null) return;
        handle(event);
      };
    for (const [type, handle] of [
      ['pointermove', (e: globalThis.PointerEvent) => this.#pointerMove(e)],
      ['pointerup', (e: globalThis.PointerEvent) => this.#pointerUp(e)],
      ['pointercancel', (e: globalThis.PointerEvent) => this.#pointerCancel(e)],
    ] as const) {
      window?.addEventListener(type, outside(pointer(handle)), options);
    }
    // Escape, or the page losing focus, ends the browser's lock.
    element.ownerDocument.addEventListener(
      'pointerlockchange',
      () => {
        if (element.ownerDocument.pointerLockElement !== element)
          this.#lock = null;
      },
      options,
    );
    // Scroll views scroll natively, moving their content under the pointer.
    element.addEventListener('scroll', () => this.#hoverChanged(), {
      ...options,
      capture: true,
    });
    // The browser's own press handling (focus, text selection) is the
    // view's, except placing the caret in a text input.
    element.addEventListener(
      'mousedown',
      (e) => {
        if (!this.#nativeDown) e.preventDefault();
      },
      options,
    );
    element.addEventListener('click', (e) => this.#click(e), options);
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
    const local = UiNode.localPoint(target, x, y);
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
      offsetX: local.x,
      offsetY: local.y,
      // The browser's, in CSS pixels; synthetic events may have none.
      movementX: (event.movementX ?? 0) / scale,
      movementY: (event.movementY ?? 0) / scale,
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
      state = { captured: null, hovered: [], last: null, inside: false };
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
    // Implicit capture until the last button is up, from before the
    // listeners run, so they can lock it (a node they remove lets go).
    if (state.captured === null) state.captured = target;
    const allowed = target.dispatchEvent(
      this.#pointerEvent('pointerdown', target, event, true, true),
    );
    if (state.captured?.isConnected !== true) state.captured = null;
    if (!allowed) {
      event.preventDefault();
      this.#capture(event.pointerId);
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
    // The browser's own press (selecting text) needs the moves itself:
    // Firefox sends them to the element holding the pointer. Soundor still
    // routes them to the pressed node, and a release outside the view
    // arrives through the window.
    if (!this.#nativeDown) this.#capture(event.pointerId);
    this.focus(focusTarget?.isConnected ? focusTarget : null);
  }

  /** Keeps the pointer's input on the view until it is released. */
  #capture(pointerId: number): void {
    try {
      this.rootElement.setPointerCapture(pointerId);
    } catch {
      // Synthetic or already released pointers cannot be captured.
    }
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
    this.#endLock(event.pointerId);
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
    this.#endLock(event.pointerId);
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
