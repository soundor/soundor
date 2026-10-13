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
  readonly parameters: ReturnType<typeof createParameterStore>;
  readonly storage = new MemoryStorage(() => this.assertActive());
  readonly plugin: Readonly<{ id: string; name: string }>;
  readonly native: Record<string, (...args: never[]) => unknown>;
  private readonly nativeMethods?: ReadonlySet<string>;
  private focused: TestNode | null = null;
  private disposed = false;
  private reducedMotion = false;
  private hostState: HostSnapshot;
  private hostListeners = new Listeners<HostSnapshot>();
  private clipboardText = '';
  private cleanups = new Set<() => void>();
  private committed = new WeakMap<TestNode, string>();
  readonly pointer = {
    target: null as TestNode | null,
    down: null as TestNode | null,
    buttons: 0,
  };
  readonly keys = new Set<string>();
  constructor(options: RuntimeOptions = {}) {
    this.root = new TestNode(this, 'view');
    this.overlayRoot = new TestNode(this, 'view');
    this.parameters = createParameterStore(options.parameters ?? []);
    this.plugin = Object.freeze({
      ...(options.plugin ?? { id: 'soundor.test', name: 'Soundor Test' }),
    });
    this.nativeMethods =
      options.nativeMethods && new Set(options.nativeMethods);
    this.native = Object.assign(Object.create(null), options.native);
    this.hostState = Object.freeze({
      sampleRate: 48000,
      blockSize: 128,
      hostName: 'Soundor Test',
      transport: null,
      ...options.host,
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
    this.focused = node;
    previous?.dispatchEvent(
      new TestEvent('blur', { relatedTarget: node, cancelable: false }, false),
    );
    if (node && this.focused === node)
      node.dispatchEvent(
        new TestEvent(
          'focus',
          { relatedTarget: previous, cancelable: false },
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
  fire(node: TestNode, type: string, init: Record<string, unknown> = {}) {
    this.assertNode(node);
    const event = new TestEvent(
      type,
      {
        cancelable: ![
          'focus',
          'blur',
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
      !['focus', 'blur', 'scroll', 'pointerenter', 'pointerleave'].includes(
        type,
      ),
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
    this.pointer.down ??= node;
    this.pointer.target = node;
    this.pointer.buttons |= [1, 4, 2][button]!;
    const target = this.pointer.down;
    const event = this.fire(target, 'pointerdown', init);
    if (!event.defaultPrevented) {
      let focus: TestNode | null = target;
      while (focus && !focus.focusable) focus = focus.parent;
      this.moveFocus(focus);
    }
    if (button === 2) this.fire(target, 'contextmenu', init);
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
    let event: TestEvent;
    try {
      event = this.fire(down ?? node, 'pointerup', init);
    } finally {
      if (this.pointer.buttons === 0) this.pointer.down = null;
    }
    if (this.pointer.buttons === 0 && button === 0 && down) {
      // Native Surface sends click to the deepest shared physical ancestor.
      let common: TestNode | null = down;
      while (common && !common.contains(node)) common = common.parent;
      if (common) this.fire(common, 'click', init);
    }
    return event;
  }

  pointerCancel() {
    this.assertActive();
    if (this.pointer.down) this.assertNode(this.pointer.down);
    const down = this.pointer.down;
    this.pointer.down = null;
    this.pointer.buttons = 0;
    if (down) this.fire(down, 'pointercancel');
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
    const state = { pressed: false, hovered: false, focused: node.focused };
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
      focus: () => change({ focused: true }),
      blur: () => change({ focused: false }),
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
  mockNative(name: string, implementation: (...args: never[]) => unknown) {
    this.assertActive();
    if (this.nativeMethods && !this.nativeMethods.has(name))
      throw new Error(`Unknown soundor:native method '${name}'`);
    if (typeof implementation !== 'function')
      throw new TypeError(`soundor:native.${name} mock must be a function`);
    this.native[name] = implementation;
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
    this.hostListeners.clear();
    this.storage.dispose();
    for (const node of this.nodes.values()) {
      node.listeners.clear();
      node.kids.length = 0;
      node.parent = null;
      node.accessibilityParent = null;
    }
    this.nodes.clear();
    this.focused = null;
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
