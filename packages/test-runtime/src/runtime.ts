import { StateHistory, StateStore } from '@soundor/core/state';

import { TestAnimation } from './animation';
import { VirtualClock } from './clock';
import { Listeners } from './listeners';
import { TestNode, TestEvent } from './node';
import { createParameterStore } from './parameters';
import { semanticTree, semanticSnapshot } from './semantics';
import {
  MemoryStorage,
  type RuntimeOptions,
  type HostSnapshot,
  type EditorInit,
  type EditorSize,
  type ViewRect,
  type ViewSize,
  type ViewSizeInit,
} from './services';
import type {
  AnimationDescription,
  AnimationKeyframe,
  AnimationOptions,
  NodeType,
  Style,
} from './types';

export class TestRuntime {
  nextId = 1;
  readonly nodes = new Map<number, TestNode>();
  readonly clock = new VirtualClock();
  /** Live ownership: running, paused, or a retained forward fill. */
  readonly animations = new Set<TestAnimation>();
  readonly activeAnimations = new Set<TestAnimation>();
  private readonly animationsByNode = new Map<TestNode, Set<TestAnimation>>();
  animationSamples = 0;
  readonly pressables = new Map<TestNode, Record<string, unknown>>();
  readonly root: TestNode;
  readonly overlayRoot: TestNode;
  readonly history = new StateHistory();
  readonly state: StateStore;
  readonly parameters: ReturnType<typeof createParameterStore>;
  readonly storage = new MemoryStorage(() => this.assertActive());
  readonly plugin: Readonly<{ id: string; name: string }>;
  readonly native: Record<string, (...args: never[]) => unknown>;
  private readonly nativeMethods?: ReadonlySet<string>;
  private readonly nativeEvents?: ReadonlySet<string>;
  private readonly nativeEventListeners = new Map<string, Listeners<unknown>>();
  private readonly nativeChannelNames?: ReadonlySet<string>;
  private readonly nativeChannelStates = new Map<
    string,
    {
      value: unknown;
      sequence: number;
      listeners: Listeners<{ value: unknown; sequence: number }>;
    }
  >();
  private focused: TestNode | null = null;
  /**
   * Whether the focused node shows its focus, and whether the last input
   * was the keyboard's (or assistive technology's) rather than a pointer
   * press, as the JUCE runtime decides.
   */
  private focusShown = false;
  private keyboardModality = true;
  private disposed = false;
  private readonly pendingScrolls = new Set<TestNode>();
  private reducedMotion = false;
  private hostState: HostSnapshot;
  private hostListeners = new Listeners<HostSnapshot>();
  private size: ViewSize;
  /** The safe area a test set; null: the whole view. */
  private safe: ViewRect | null = null;
  private sizeListeners = new Listeners<ViewSize>();
  private editor: EditorSize;
  private editorListeners = new Listeners<EditorSize>();
  private readonly editorPolicy: Required<
    Omit<EditorInit, 'width' | 'height' | 'resizable'>
  >;
  /** The sizes requestEditorSize() asked for, held to the limits. */
  private readonly editorRequests: { width: number; height: number }[] = [];
  /** The size the simulated host is about to give, if any. */
  private pendingEditorSize: { width: number; height: number } | null = null;
  private clipboardText = '';
  private cleanups = new Set<() => void>();
  private committed = new WeakMap<TestNode, string>();
  readonly pointer = {
    target: null as TestNode | null,
    down: null as TestNode | null,
    buttons: 0,
    type: 'mouse' as string,
    /** The node holding the pointer lock: the press goes to it until released. */
    locked: null as TestNode | null,
    /** The press's click count: `detail` of its click. */
    clicks: 1,
  };
  readonly keys = new Set<string>();
  constructor(options: RuntimeOptions = {}) {
    this.root = new TestNode(this, 'view');
    this.overlayRoot = new TestNode(this, 'view');
    this.parameters = createParameterStore(
      options.parameters ?? [],
      this.history,
    );
    this.state = new StateStore(
      options.state ?? { fields: [], types: [] },
      this.history,
    );
    this.plugin = Object.freeze({
      ...(options.plugin ?? { id: 'soundor.test', name: 'Soundor Test' }),
    });
    this.nativeMethods =
      options.nativeMethods && new Set(options.nativeMethods);
    this.nativeEvents = options.nativeEvents && new Set(options.nativeEvents);
    this.nativeChannelNames =
      options.nativeChannels && new Set(options.nativeChannels);
    this.native = Object.assign(Object.create(null), options.native);
    this.hostState = Object.freeze({
      sampleRate: 48000,
      blockSize: 128,
      hostName: 'Soundor Test',
      transport: null,
      ...options.host,
    });
    const { safeArea = null, ...view } = options.view ?? {};
    this.safe = safeArea;
    this.size = this.viewSnapshot(
      { width: 800, height: 600, scale: 1, ...view },
      safeArea,
    );
    const {
      width = this.size.width,
      height = this.size.height,
      resizable = false,
      ...policy
    } = options.editor ?? {};
    this.editor = this.editorSnapshot({ width, height, resizable });
    this.editorPolicy = {
      minWidth: 1,
      minHeight: 1,
      maxWidth: Infinity,
      maxHeight: Infinity,
      aspectRatio: null,
      applyRequests: true,
      ...policy,
    };
  }
  /** A checked, frozen view size, safe in `safe` (null: all of it). */
  private viewSnapshot(
    next: Omit<ViewSize, 'safeArea'>,
    safe: ViewRect | null,
  ): ViewSize {
    for (const key of ['width', 'height', 'scale'] as const) {
      if (!(Number.isFinite(next[key]) && next[key] >= 0))
        throw new RangeError(
          `The view's ${key} must be a finite, non-negative number`,
        );
    }
    if (
      safe !== null &&
      !(['x', 'y', 'width', 'height'] as const).every((key) =>
        Number.isFinite(safe[key]),
      )
    )
      throw new RangeError(
        "The view's safe area must be null or a rectangle of finite numbers",
      );
    const { width, height, scale } = next;
    const { x, y, width: w, height: h } = safe ?? { x: 0, y: 0, width, height };
    return Object.freeze({
      width,
      height,
      scale,
      safeArea: Object.freeze({ x, y, width: w, height: h }),
    });
  }
  private editorSnapshot(next: EditorSize): EditorSize {
    for (const key of ['width', 'height'] as const) {
      if (!(Number.isInteger(next[key]) && next[key] >= 0))
        throw new RangeError(
          `The editor's ${key} must be a whole, non-negative number of logical pixels`,
        );
    }
    if (typeof next.resizable !== 'boolean')
      throw new TypeError("The editor's resizable must be a boolean");
    return Object.freeze({
      width: next.width,
      height: next.height,
      resizable: next.resizable,
    });
  }
  get isDisposed() {
    return this.disposed;
  }
  assertActive() {
    if (this.disposed)
      throw new Error('Soundor test runtime has been disposed');
  }
  assertNode(node: TestNode) {
    this.assertActive();
    if (node?.runtime !== this)
      throw new TypeError('node belongs to another runtime');
  }
  create(type: NodeType, style: Style = {}) {
    const node = new TestNode(this, type);
    node.style = { ...style };
    return node;
  }
  focusedNode() {
    if (this.focused !== null && !this.focused.isConnected) this.focused = null;
    return this.focused;
  }
  focusVisible() {
    return this.focusedNode() !== null && this.focusShown;
  }
  moveFocus(node: TestNode | null) {
    this.assertActive();
    if (
      node &&
      (node.runtime !== this ||
        !node.focusable ||
        !node.isConnected ||
        !this.focusEligible(
          node,
          semanticSnapshot([this.root, this.overlayRoot]).hidden,
        ))
    )
      return;
    const previous = this.focusedNode();
    if (previous === node) return;
    const wasShown = previous !== null && this.focusShown;
    this.focused = node;
    // Text inputs show focus however they got it, as in browsers.
    this.focusShown =
      node !== null && (this.keyboardModality || node.type === 'input');
    const shown = this.focusShown;
    if (previous) {
      previous.dispatchEvent(
        new TestEvent(
          'blur',
          { relatedTarget: node, cancelable: false },
          false,
        ),
      );
      if (wasShown && previous.isConnected)
        previous.dispatchEvent(
          new TestEvent('focusvisiblechange', { cancelable: false }, false),
        );
    }
    if (node && this.focused === node) {
      node.dispatchEvent(
        new TestEvent(
          'focus',
          { relatedTarget: previous, cancelable: false, focusVisible: shown },
          false,
        ),
      );
      if (shown && this.focused === node && this.focusShown)
        node.dispatchEvent(
          new TestEvent(
            'focusvisiblechange',
            { cancelable: false, focusVisible: true },
            false,
          ),
        );
    }
  }
  /** Shows the focused node's focus, from a key press on. */
  private showFocus() {
    const node = this.focusedNode();
    if (node === null || this.focusShown) return;
    this.focusShown = true;
    node.dispatchEvent(
      new TestEvent(
        'focusvisiblechange',
        { cancelable: false, focusVisible: true },
        false,
      ),
    );
  }
  displayed(node: TestNode) {
    for (let at: TestNode | null = node; at; at = at.parent)
      if (at.style.display === 'none') return false;
    return true;
  }
  private focusEligible(node: TestNode, hidden: ReadonlySet<TestNode>) {
    return (
      node.runtime === this &&
      node.isConnected &&
      node.focusable &&
      !hidden.has(node)
    );
  }
  focusOrder(): TestNode[] {
    const hidden = semanticSnapshot([this.root, this.overlayRoot]).hidden;
    const order: TestNode[] = [];
    const walk = (node: TestNode) => {
      if (this.focusEligible(node, hidden)) order.push(node);
      // A physical parent outside the modal may hold content read inside it.
      node.children.forEach(walk);
    };
    walk(this.root);
    walk(this.overlayRoot);
    return order;
  }
  pressKey(key: string, init: Record<string, unknown> = {}) {
    this.keys.add(key);
    // Using the keyboard shows focus: not a shortcut, nor a modifier alone.
    if (
      !init['ctrlKey'] &&
      !init['altKey'] &&
      !init['metaKey'] &&
      !['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock'].includes(key)
    ) {
      this.keyboardModality = true;
      this.showFocus();
    }
    const event = new TestEvent('keydown', { key, ...init });
    (this.focusedNode() ?? this.root).dispatchEvent(event);
    if (
      !event.defaultPrevented &&
      key === 'Tab' &&
      !init['ctrlKey'] &&
      !init['altKey'] &&
      !init['metaKey']
    ) {
      const order = this.focusOrder(),
        index = order.indexOf(this.focusedNode()!);
      const back = Boolean(init['shiftKey']);
      if (order.length)
        this.moveFocus(
          order[
            index < 0
              ? back
                ? order.length - 1
                : 0
              : (index + (back ? order.length - 1 : 1)) % order.length
          ]!,
        );
    }
    return event;
  }
  releaseKey(key: string, init: Record<string, unknown> = {}) {
    this.keys.delete(key);
    const event = new TestEvent('keyup', { key, ...init });
    (this.focusedNode() ?? this.root).dispatchEvent(event);
    return event;
  }
  /**
   * Fires `scroll` at a node moved from code, once, at the next frame and ahead
   * of its callbacks, as the runtimes do: not during the call.
   */
  scrolled(node: TestNode) {
    this.pendingScrolls.add(node);
    if (this.pendingScrolls.size > 1) return;
    this.clock.setTimeout(
      () => {
        const moved = [...this.pendingScrolls];
        this.pendingScrolls.clear();
        for (const each of moved)
          if (each.isConnected) this.fire(each, 'scroll');
      },
      this.clock.untilNextFrame(),
      true,
    );
  }

  fire(node: TestNode, type: string, init: Record<string, unknown> = {}) {
    this.assertNode(node);
    // Assistive technology moves focus as the keyboard does: shown.
    if (type === 'accessibilityaction') this.keyboardModality = true;
    const event = new TestEvent(
      type,
      {
        cancelable: ![
          'focus',
          'blur',
          'focusvisiblechange',
          'input',
          'change',
          'scroll',
          'pointercancel',
          'pointerenter',
          'pointerleave',
        ].includes(type),
        button: 0,
        buttons: this.pointer.buttons,
        pointerId: 0,
        pointerType: 'mouse',
        ...init,
      },
      ![
        'focus',
        'blur',
        'focusvisiblechange',
        'scroll',
        'pointerenter',
        'pointerleave',
      ].includes(type),
    );
    node.dispatchEvent(event);
    return event;
  }
  pointerDown(node: TestNode, init: Record<string, unknown> = {}) {
    this.assertNode(node);
    if (this.pointer.down) this.assertNode(this.pointer.down);
    const button = Number(init['button'] ?? 0);
    if (![0, 1, 2].includes(button))
      throw new RangeError(
        'Supported mouse buttons are primary, middle, and secondary',
      );
    if (this.pointer.down === null) {
      this.pointer.type = String(init['pointerType'] ?? 'mouse');
      // Which press of a series this is, as a platform counts them.
      const clicks = Number(init['detail'] ?? 1);
      if (!Number.isInteger(clicks) || clicks < 1)
        throw new RangeError('A press counts its clicks from 1 (detail)');
      this.pointer.clicks = clicks;
    }
    this.pointer.down ??= node;
    this.pointer.target = node;
    this.pointer.buttons |= [1, 4, 2][button]!;
    // Focus a press moves is not shown.
    this.keyboardModality = false;
    const target = this.pointer.down;
    // Pointer events say no count (detail 0); the press's click does.
    const { detail: _detail, ...pointerInit } = init;
    const event = this.fire(target, 'pointerdown', pointerInit);
    if (!event.defaultPrevented) {
      let focus: TestNode | null = target;
      while (focus && !focus.focusable) focus = focus.parent;
      this.moveFocus(focus);
    }
    if (button === 2) this.fire(target, 'contextmenu', pointerInit);
    return event;
  }
  pointerMove(node: TestNode, init: Record<string, unknown> = {}) {
    this.assertNode(node);
    if (this.pointer.down) this.assertNode(this.pointer.down);
    this.pointer.target = node;
    return this.fire(this.pointer.down ?? node, 'pointermove', {
      button: -1,
      ...init,
    });
  }
  pointerUp(node: TestNode, init: Record<string, unknown> = {}) {
    this.assertNode(node);
    if (this.pointer.down) this.assertNode(this.pointer.down);
    const button = Number(init['button'] ?? 0);
    if (![0, 1, 2].includes(button))
      throw new RangeError(
        'Supported mouse buttons are primary, middle, and secondary',
      );
    const down = this.pointer.down;
    this.pointer.target = node;
    this.pointer.buttons &= ~[1, 4, 2][button]!;
    // The count is the press's (pointerDown's detail).
    const { detail: _detail, ...pointerInit } = init;
    let event: TestEvent;
    try {
      event = this.fire(down ?? node, 'pointerup', pointerInit);
    } finally {
      if (this.pointer.buttons === 0) {
        this.pointer.down = null;
        this.pointer.locked = null;
      }
    }
    if (this.pointer.buttons === 0 && button === 0 && down) {
      // Native Surface sends click to the deepest shared physical ancestor.
      let common: TestNode | null = down;
      while (common && !common.contains(node)) common = common.parent;
      if (common) {
        const detail = this.pointer.clicks;
        this.fire(common, 'click', { ...pointerInit, detail });
        // The second click of a series is also a double click.
        if (detail === 2 && common.isConnected)
          this.fire(common, 'dblclick', { ...pointerInit, detail });
      }
    }
    return event;
  }

  pointerCancel() {
    this.assertActive();
    if (this.pointer.down) this.assertNode(this.pointer.down);
    const down = this.pointer.down;
    this.pointer.down = null;
    this.pointer.locked = null;
    this.pointer.buttons = 0;
    if (down) this.fire(down, 'pointercancel');
  }

  /** As the runtimes: locks a mouse or pen pressing `node` or a node in it. */
  requestPointerLock(node: TestNode): Promise<void> {
    const down = this.pointer.down;
    if (
      down === null ||
      this.pointer.type === 'touch' ||
      !node.isConnected ||
      !node.contains(down)
    ) {
      return Promise.reject(
        new DOMException(
          'requestPointerLock(): no press of this node to lock',
          'NotAllowedError',
        ),
      );
    }
    this.pointer.down = node;
    this.pointer.locked = node;
    return Promise.resolve();
  }
  exitPointerLock() {
    this.pointer.locked = null;
  }
  pointerLockNode(): TestNode | null {
    const locked = this.pointer.locked;
    if (
      locked !== null &&
      (!locked.isConnected || this.pointer.down !== locked)
    )
      this.pointer.locked = null;
    return this.pointer.locked;
  }
  defaultAction(node: TestNode, event: TestEvent) {
    if (event.type === 'accessibilityaction') {
      if (
        event['actionName'] === 'focus' ||
        (node.type === 'input' && event['actionName'] === 'activate')
      )
        node.focus();
      else if (event['actionName'] === 'blur') node.blur();
      else if (
        node.type === 'input' &&
        event['actionName'] === 'setValue' &&
        typeof event['value'] === 'string'
      ) {
        node.value = event['value'].replace(/[\r\n]+/g, ' ');
        this.fire(node, 'input', {
          inputType: 'insertReplacementText',
          data: node.value,
        });
        this.commit(node);
      }
    }
    if (node.type !== 'input') return;
    if (event.type === 'focus') {
      if (!this.committed.has(node)) this.committed.set(node, node.value);
    } else if (event.type === 'blur') this.commit(node);
    else if (event.type === 'beforeinput')
      this.replaceSelection(node, String(event['data'] ?? ''), 'insertText');
    else if (event.type === 'keydown') {
      const key = event['key'];
      const start = node.selectionStart,
        end = node.selectionEnd;
      if (key === 'Enter') this.commit(node);
      else if ((event['ctrlKey'] || event['metaKey']) && key === 'a')
        node.select();
      else if (key === 'Home') node.setSelectionRange(0, 0);
      else if (key === 'End')
        node.setSelectionRange(node.value.length, node.value.length);
      else if (key === 'ArrowLeft' || key === 'ArrowRight') {
        const at = Math.max(
          0,
          Math.min(
            node.value.length,
            key === 'ArrowLeft' ? start - 1 : end + 1,
          ),
        );
        node.setSelectionRange(at, at);
      } else if (key === 'Backspace' || key === 'Delete') {
        if (start === end) {
          const at = key === 'Backspace' ? start - 1 : end + 1;
          node.setSelectionRange(
            Math.max(0, Math.min(start, at)),
            Math.min(node.value.length, Math.max(end, at)),
          );
        }
        this.replaceSelection(
          node,
          '',
          key === 'Backspace'
            ? 'deleteContentBackward'
            : 'deleteContentForward',
        );
      }
    }
  }
  private commit(node: TestNode) {
    if (this.committed.get(node) === node.value) return;
    this.committed.set(node, node.value);
    this.fire(node, 'change');
  }
  private replaceSelection(node: TestNode, data: string, inputType: string) {
    const at = node.selectionStart;
    data = data.replace(/[\r\n]+/g, ' ');
    node.value =
      node.value.slice(0, at) + data + node.value.slice(node.selectionEnd);
    node.setSelectionRange(at + data.length, at + data.length);
    this.fire(node, 'input', { data, inputType });
  }
  pressable(node: TestNode, handlers: Record<string, unknown> = {}) {
    this.assertActive();
    if (node.runtime !== this)
      throw new TypeError('node belongs to another runtime');
    const state = {
      pressed: false,
      hovered: false,
      focused: node.focused,
      focusVisible: node.focusVisible,
    };
    let originX = 0,
      originY = 0;
    let timer: number | undefined,
      longPressed = false;
    const call = (name: string, event: unknown) => {
      (handlers[name] as ((event: unknown) => void) | undefined)?.(event);
    };
    const change = (next: Partial<typeof state>) => {
      if (
        Object.entries(next).every(
          ([key, value]) => state[key as keyof typeof state] === value,
        )
      )
        return;
      Object.assign(state, next);
      call('onStateChange', { ...state });
    };
    const stop = () => {
      if (timer !== undefined) this.clock.clearTimeout(timer);
      timer = undefined;
    };
    const listeners: Record<string, (event: TestEvent) => void> = {
      pointerdown: (event) => {
        if (event['button'] !== 0 && event['button'] !== undefined) return;
        stop();
        longPressed = false;
        originX = Number(event['pageX'] ?? 0);
        originY = Number(event['pageY'] ?? 0);
        change({ pressed: true });
        call('onPressIn', event);
        if (handlers['onLongPress'])
          timer = this.clock.setTimeout(
            () => {
              longPressed = true;
              call('onLongPress', event);
            },
            Number(handlers['delayLongPress'] ?? 500),
          );
      },
      pointermove: (event) => {
        if (
          Math.hypot(
            Number(event['pageX'] ?? 0) - originX,
            Number(event['pageY'] ?? 0) - originY,
          ) > 10
        )
          stop();
      },
      pointerup: (event) => {
        stop();
        if (state.pressed) {
          change({ pressed: false });
          call('onPressOut', event);
        }
      },
      pointercancel: (event) => {
        stop();
        longPressed = false;
        if (state.pressed) {
          change({ pressed: false });
          call('onPressOut', event);
        }
      },
      click: (event) => {
        if (longPressed) {
          longPressed = false;
          return;
        }
        call('onPress', event);
      },
      pointerenter: (event) => {
        change({ hovered: true });
        call('onHoverIn', event);
      },
      pointerleave: (event) => {
        change({ hovered: false });
        call('onHoverOut', event);
      },
      focus: (event) =>
        change({ focused: true, focusVisible: Boolean(event['focusVisible']) }),
      blur: () => change({ focused: false, focusVisible: false }),
      focusvisiblechange: (event) =>
        change({ focusVisible: Boolean(event['focusVisible']) }),
      keydown: (event) => {
        if (
          event.target !== node ||
          event['repeat'] ||
          !['Enter', ' '].includes(String(event['key']))
        )
          return;
        event.preventDefault();
        call('onPress', event);
      },
      accessibilityaction: (event) => {
        if (event.target !== node || event.defaultPrevented) return;
        const name =
          event['actionName'] === 'activate'
            ? 'onPress'
            : event['actionName'] === 'longpress'
              ? 'onLongPress'
              : '';
        if (name && handlers[name]) {
          event.preventDefault();
          call(name, event);
        }
      },
    };
    Object.entries(listeners).forEach(([type, listener]) =>
      node.addEventListener(type, listener),
    );
    node.focusable = true;
    this.pressables.set(node, handlers);
    const cleanup = () => {
      stop();
      Object.entries(listeners).forEach(([type, listener]) =>
        node.removeEventListener(type, listener),
      );
      this.pressables.delete(node);
      this.cleanups.delete(cleanup);
    };
    this.cleanups.add(cleanup);
    return cleanup;
  }
  animate(
    node: TestNode,
    frames: readonly AnimationKeyframe[] | AnimationDescription,
    options: AnimationOptions = {},
  ) {
    this.assertNode(node);
    const animation = new TestAnimation(this, node, frames, options);
    this.acquireAnimation(animation);
    if (this.reducedMotion) animation.reduceMotion();
    return animation;
  }
  /** Reacquire compiled handles on replay, resolving conflicts by ownership. */
  acquireAnimation(animation: TestAnimation) {
    this.assertActive();
    if (this.animations.has(animation)) return;
    for (const [node, properties] of animation.owned) {
      this.assertNode(node);
      for (const previous of this.animationsByNode.get(node) ?? []) {
        if (
          [...properties].some((property) =>
            previous.owned.get(node)?.has(property),
          )
        )
          previous.cancel();
      }
    }
    if (
      animation.playState === 'idle' ||
      (animation.playState === 'finished' && !animation.retainsPresentation)
    )
      return;
    this.animations.add(animation);
    for (const node of animation.owned.keys()) {
      const owners =
        this.animationsByNode.get(node) ?? new Set<TestAnimation>();
      owners.add(animation);
      this.animationsByNode.set(node, owners);
    }
    this.animationStateChanged(animation);
  }
  animationStateChanged(animation: TestAnimation) {
    if (!this.animations.has(animation)) return;
    if (animation.playState === 'running') this.activeAnimations.add(animation);
    else this.activeAnimations.delete(animation);
    if (
      animation.playState === 'idle' ||
      (animation.playState === 'finished' && !animation.retainsPresentation)
    ) {
      this.animations.delete(animation);
      for (const node of animation.owned.keys()) {
        const owners = this.animationsByNode.get(node);
        owners?.delete(animation);
        if (owners?.size === 0) this.animationsByNode.delete(node);
      }
    }
  }
  animationsFor(node: TestNode): readonly TestAnimation[] {
    return [...(this.animationsByNode.get(node) ?? [])];
  }
  /** Explicit removal releases the subtree's programs; reparenting does not. */
  detachAnimations(node: TestNode) {
    for (const animation of this.animationsByNode.get(node) ?? [])
      animation.cancel();
    for (const child of node.children) this.detachAnimations(child);
  }
  presentation(node: TestNode): Record<string, unknown> {
    const out = { ...node.style };
    for (const animation of this.animationsByNode.get(node) ?? [])
      Object.assign(out, animation.values.get(node));
    return out;
  }
  velocity(node: TestNode): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const animation of this.animationsByNode.get(node) ?? [])
      Object.assign(values, animation.velocities.get(node));
    return values;
  }
  advanceTime(milliseconds: number) {
    this.assertActive();
    let previous = this.clock.now;
    this.clock.advance(milliseconds, () => {
      const delta = this.clock.now - previous;
      previous = this.clock.now;
      for (const animation of this.activeAnimations) {
        this.animationSamples++;
        animation.tick(delta);
      }
    });
  }
  setReducedMotion(value: boolean) {
    this.reducedMotion = value;
    if (value) this.animations.forEach((animation) => animation.reduceMotion());
  }
  prefersReducedMotion() {
    return this.reducedMotion;
  }
  semantics() {
    return semanticTree([this.root, this.overlayRoot]);
  }
  snapshot() {
    this.assertActive();
    return this.hostState;
  }
  subscribe(listener: (snapshot: HostSnapshot) => void) {
    this.assertActive();
    return this.hostListeners.add(listener, 'host.subscribe');
  }
  setHost(state: Partial<HostSnapshot>) {
    this.assertActive();
    this.hostState = Object.freeze({ ...this.hostState, ...state });
    this.hostListeners.notify(this.hostState);
  }
  viewSize() {
    this.assertActive();
    return this.size;
  }
  subscribeViewSize(listener: (size: ViewSize) => void) {
    this.assertActive();
    return this.sizeListeners.add(listener, 'subscribeViewSize()');
  }
  /**
   * Resizes the view, as a user resizing the editor would; tells subscribers
   * once per change. A safe area of null is the whole view again.
   */
  setViewSize(size: ViewSizeInit) {
    this.assertActive();
    const { safeArea = this.safe, ...view } = size;
    const { width, height, scale } = this.size;
    const next = this.viewSnapshot({ width, height, scale, ...view }, safeArea);
    this.safe = safeArea;
    const was = this.size;
    if (
      next.width === was.width &&
      next.height === was.height &&
      next.scale === was.scale &&
      next.safeArea.x === was.safeArea.x &&
      next.safeArea.y === was.safeArea.y &&
      next.safeArea.width === was.safeArea.width &&
      next.safeArea.height === was.safeArea.height
    )
      return;
    this.size = next;
    this.sizeListeners.notify(this.size);
  }
  editorSize() {
    this.assertActive();
    return this.editor;
  }
  subscribeEditorSize(listener: (size: EditorSize) => void) {
    this.assertActive();
    return this.editorListeners.add(listener, 'subscribeEditorSize()');
  }
  /**
   * Resizes the editor, as a user or a DAW would; tells subscribers once per
   * change. The view is not resized with it: nothing is laid out here.
   */
  setEditorSize(size: Partial<EditorSize>) {
    this.assertActive();
    const next = this.editorSnapshot({ ...this.editor, ...size });
    if (
      next.width === this.editor.width &&
      next.height === this.editor.height &&
      next.resizable === this.editor.resizable
    )
      return;
    this.editor = next;
    this.editorListeners.notify(this.editor);
  }
  /**
   * Asks for another editor size, checked, rounded and held to the limits
   * as the runtimes do. The simulated host gives it after the calling code
   * (a microtask), the latest request winning, unless it ignores requests.
   * Returns the size asked of it, or null where none can be.
   */
  requestEditorSize(
    width: unknown,
    height: unknown,
  ): { readonly width: number; readonly height: number } | null {
    this.assertActive();
    const wanted = {
      width: requestedSide(width, 'width'),
      height: requestedSide(height, 'height'),
    };
    if (!this.editor.resizable) return null;
    const next = constrainRequest(this.editorPolicy, wanted);
    this.editorRequests.push(next);
    const asked = Object.freeze({ ...next });
    if (!this.editorPolicy.applyRequests) return asked;
    const scheduled = this.pendingEditorSize !== null;
    this.pendingEditorSize = next;
    if (!scheduled)
      queueMicrotask(() => {
        const size = this.pendingEditorSize;
        this.pendingEditorSize = null;
        if (size !== null && !this.disposed) this.setEditorSize(size);
      });
    return asked;
  }
  /** The sizes requestEditorSize() asked for, held to the limits, in order. */
  requestedEditorSizes(): readonly { width: number; height: number }[] {
    this.assertActive();
    return this.editorRequests.map((size) => ({ ...size }));
  }
  mockNative(name: string, implementation: (...args: never[]) => unknown) {
    this.assertActive();
    if (this.nativeMethods && !this.nativeMethods.has(name))
      throw new Error(`Unknown soundor:native method '${name}'`);
    if (typeof implementation !== 'function')
      throw new TypeError(`soundor:native.${name} mock must be a function`);
    this.native[name] = implementation;
  }
  private nativeEvent(name: string): Listeners<unknown> {
    if (this.nativeEvents && !this.nativeEvents.has(name))
      throw new Error(`Unknown soundor:native event '${name}'`);
    let listeners = this.nativeEventListeners.get(name);
    if (listeners === undefined) {
      listeners = new Listeners<unknown>();
      this.nativeEventListeners.set(name, listeners);
    }
    return listeners;
  }
  /** What `events.<name>.subscribe()` of soundor:native does. */
  subscribeNativeEvent(name: string, listener: (value: unknown) => void) {
    this.assertActive();
    return this.nativeEvent(name).add(listener, `events.${name}.subscribe()`);
  }
  /**
   * Publishes a declared native event, as the plugin's native code does: its
   * subscribers receive `value` now (the runtimes deliver it at their next
   * tick).
   */
  emitNativeEvent(name: string, value: unknown = {}) {
    this.assertActive();
    this.nativeEvent(name).notify(value);
  }
  private nativeChannel(name: string) {
    if (this.nativeChannelNames && !this.nativeChannelNames.has(name))
      throw new Error(`Unknown soundor:native channel '${name}'`);
    let state = this.nativeChannelStates.get(name);
    if (state === undefined) {
      state = { value: undefined, sequence: 0, listeners: new Listeners() };
      this.nativeChannelStates.set(name, state);
    }
    return state;
  }
  /** What `channels.<name>.get()` of soundor:native returns. */
  nativeChannelValue(name: string): unknown {
    this.assertActive();
    return this.nativeChannel(name).value;
  }
  /** What `channels.<name>.subscribe()` of soundor:native does. */
  subscribeNativeChannel(
    name: string,
    listener: (value: unknown, sequence: number) => void,
  ) {
    this.assertActive();
    if (typeof listener !== 'function')
      throw new TypeError(`channels.${name}.subscribe() expects a function`);
    return this.nativeChannel(name).listeners.add(
      ({ value, sequence }) => listener(value, sequence),
      `channels.${name}.subscribe()`,
    );
  }
  /**
   * Publishes a declared native channel's latest value, as the plugin's
   * native code does: `get()` returns it and its subscribers receive it now,
   * numbered (the runtimes deliver the newest at their next tick).
   */
  publishNativeChannel(name: string, value: unknown) {
    this.assertActive();
    const state = this.nativeChannel(name);
    state.value = value;
    state.sequence += 1;
    state.listeners.notify({ value, sequence: state.sequence });
  }
  callNative(name: string, args: never[]) {
    this.assertActive();
    const method = this.native[name];
    if (!method)
      throw new Error(`soundor:native.${name} requires a configured test mock`);
    return method(...args);
  }
  readonly clipboard = {
    readText: async () => {
      this.assertActive();
      return this.clipboardText;
    },
    writeText: async (text: string) => {
      this.assertActive();
      this.clipboardText = text;
    },
  };
  dispose() {
    if (this.disposed) return;
    this.cleanups.forEach((cleanup) => cleanup());
    this.animations.forEach((animation) => animation.cancel());
    this.animations.clear();
    this.activeAnimations.clear();
    this.animationsByNode.clear();
    this.clock.clear();
    this.parameters.list.forEach((parameter) => parameter.dispose());
    this.state.resetGestures();
    this.hostListeners.clear();
    this.sizeListeners.clear();
    this.editorListeners.clear();
    this.storage.dispose();
    for (const node of this.nodes.values()) {
      node.listeners.clear();
      node.svgScene = null;
      node.kids.length = 0;
      node.parent = null;
      node.accessibilityParent = null;
    }
    this.nodes.clear();
    this.focused = null;
    this.focusShown = false;
    this.keyboardModality = true;
    this.pointer.down = null;
    this.pointer.target = null;
    this.pointer.buttons = 0;
    this.keys.clear();
    this.disposed = true;
  }
}
export function createTestRuntime(options: RuntimeOptions = {}) {
  return new TestRuntime(options);
}

/**
 * One side of a size requestEditorSize() is asked for, checked and whole:
 * any finite number, held to 1 to 0x3FFFFFFF as the JUCE runtime holds it.
 */
function requestedSide(value: unknown, name: string): number {
  if (typeof value !== 'number')
    throw new TypeError(
      `requestEditorSize(): ${name} must be a number, got ${describe(value)}`,
    );
  if (!Number.isFinite(value))
    throw new RangeError(
      `requestEditorSize(): ${name} must be a finite number, got ${value}`,
    );
  return Math.min(Math.max(Math.round(value), 1), 0x3fffffff);
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'object')
    return (
      (value as { constructor?: { name?: string } }).constructor?.name ??
      'object'
    );
  return typeof value;
}

/**
 * A request held to the editor's limits, as the runtimes hold it: each side
 * within them, or keeping the configured aspect ratio, that size times the
 * zoom nearest to the size asked for, within the zooms the limits allow,
 * rounded. Never from the current size.
 */
function constrainRequest(
  policy: Required<Omit<EditorInit, 'width' | 'height' | 'resizable'>>,
  wanted: { width: number; height: number },
): { width: number; height: number } {
  const held = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), Math.max(min, max));
  const ratio = policy.aspectRatio;
  if (ratio === null)
    return {
      width: held(wanted.width, policy.minWidth, policy.maxWidth),
      height: held(wanted.height, policy.minHeight, policy.maxHeight),
    };
  const asked =
    (wanted.width * ratio.width + wanted.height * ratio.height) /
    (ratio.width * ratio.width + ratio.height * ratio.height);
  const zoom = held(
    asked,
    Math.max(policy.minWidth / ratio.width, policy.minHeight / ratio.height),
    Math.min(policy.maxWidth / ratio.width, policy.maxHeight / ratio.height),
  );
  return {
    width: Math.round(ratio.width * zoom),
    height: Math.round(ratio.height * zoom),
  };
}
