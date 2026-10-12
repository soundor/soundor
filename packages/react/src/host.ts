/**
 * The react-reconciler host config: React's mutations applied to soundor:ui
 * nodes.
 *
 * Every host element is a soundor:ui node, except text inside <Text>: raw
 * strings and nested <Text> elements are spans kept here, and the outermost
 * <Text> shows their concatenation (as in React Native).
 */

import { createContext } from 'react';
import type { ReactContext } from 'react-reconciler';
import {
  ContinuousEventPriority,
  DefaultEventPriority,
  DiscreteEventPriority,
  NoEventPriority,
} from 'react-reconciler/constants';
import {
  createCanvas,
  createImage,
  createScrollView,
  createText,
  createTextInput,
  createView,
  type KeyboardEvent,
  type AnimationOptions,
  type AnimationKeyframe,
  type AnimationDescription,
  type UiAnimation,
  type Style,
  type UiNode,
} from 'soundor:ui';

import { ACCESSIBILITY_PROPS, accessibilityOf } from './accessibility';
import { tagScope, type Scope } from './focus';
import { flattenStyle } from './style';

/** The host element types the components render. */
export const HostTypes = {
  View: 'soundor-view',
  Text: 'soundor-text',
  Image: 'soundor-image',
  ScrollView: 'soundor-scroll',
  TextInput: 'soundor-input',
  Canvas: 'soundor-canvas',
} as const;

export type HostType = (typeof HostTypes)[keyof typeof HostTypes];

/**
 * The prop components pass their FocusScope through: host elements cannot
 * read context.
 */
export const SCOPE_PROP = '__soundorFocusScope';
export const TRANSITION_PROP = '__soundorTransition';
export const ANIMATION_PROP = '__soundorAnimation';
const instancesByNode = new WeakMap<UiNode, NodeInstance>();

type Props = Record<string, unknown>;

/** A host element backed by a soundor:ui node. */
export class NodeInstance {
  readonly kind = 'node';
  /** Text nodes: their spans, flattened into the node's text. */
  readonly spans: Span[] = [];
  /** By the prop that asked for it. */
  readonly listeners = new Map<
    string,
    { type: string; capture: boolean; listener: (event: Event) => void }
  >();
  hidden = false;
  /** The node's accessibility as last set, to set it only when it changes. */
  accessibility = '{}';
  /**
   * The style as last set: a plain object, to compare with without going
   * through `node.style` (a view of the node's style).
   */
  style: Style | null = null;
  animation: UiAnimation | null = null;

  constructor(
    readonly type: HostType,
    readonly node: UiNode,
    public props: Props,
  ) {
    instancesByNode.set(node, this);
  }
}

/** A raw string, or a <Text> nested in another, inside a <Text>. */
export class SpanInstance {
  readonly kind = 'span';
  readonly spans: Span[] = [];
  parent: NodeInstance | SpanInstance | null = null;
  hidden = false;

  constructor(public text: string | null) {}
}

type Span = SpanInstance;
export type Instance = NodeInstance | SpanInstance;

export interface HostContext {
  readonly insideText: boolean;
}

// ── Events ──────────────────────────────────────────────────────────────────

/** Event props and the soundor:ui events they listen to. */
const EVENT_PROPS: Readonly<Record<string, string>> = {
  onPointerDown: 'pointerdown',
  onPointerMove: 'pointermove',
  onPointerUp: 'pointerup',
  onPointerCancel: 'pointercancel',
  onPointerEnter: 'pointerenter',
  onPointerLeave: 'pointerleave',
  onClick: 'click',
  onContextMenu: 'contextmenu',
  onWheel: 'wheel',
  onKeyDown: 'keydown',
  onKeyUp: 'keyup',
  onFocus: 'focus',
  onBlur: 'blur',
  onScroll: 'scroll',
  onBeforeInput: 'beforeinput',
  onInput: 'input',
  onChange: 'change',
};

const CONTINUOUS = new Set([
  'pointermove',
  'pointerenter',
  'pointerleave',
  'wheel',
  'scroll',
]);

let currentUpdatePriority: number = NoEventPriority;
let currentEventPriority: number = DefaultEventPriority;

/**
 * Runs a listener with the update priority its event deserves: discrete
 * input (a press, a key) renders before the next task.
 */
export function prioritized(type: string, run: () => void): void {
  const previous = currentEventPriority;
  currentEventPriority = CONTINUOUS.has(type)
    ? ContinuousEventPriority
    : DiscreteEventPriority;
  try {
    run();
  } finally {
    currentEventPriority = previous;
  }
}

/** The prop names an instance listens through, and their events. */
function eventBindings(
  instance: NodeInstance,
  props: Props,
): Map<
  string,
  { type: string; capture: boolean; call: (event: Event) => void }
> {
  const bindings = new Map<
    string,
    { type: string; capture: boolean; call: (event: Event) => void }
  >();
  for (const [name, value] of Object.entries(props)) {
    if (typeof value !== 'function') continue;
    const capture = name.endsWith('Capture');
    const base = capture ? name.slice(0, -'Capture'.length) : name;
    const type = EVENT_PROPS[base];
    if (type === undefined) continue;
    bindings.set(name, {
      type,
      capture,
      call: (event) => (instance.props[name] as (event: Event) => void)(event),
    });
  }
  // Actions asked of this element only, as in React Native.
  if (typeof props['onAccessibilityAction'] === 'function') {
    bindings.set('onAccessibilityAction', {
      type: 'accessibilityaction',
      capture: false,
      call: (event) => {
        if (event.target === instance.node)
          (instance.props['onAccessibilityAction'] as (event: Event) => void)(
            event,
          );
      },
    });
  }
  // Inputs report their text and Enter through their own props.
  if (instance.type === HostTypes.TextInput) {
    if (typeof props['onChangeText'] === 'function') {
      bindings.set('onChangeText', {
        type: 'input',
        capture: false,
        call: () =>
          (instance.props['onChangeText'] as (text: string) => void)(
            instance.node.value,
          ),
      });
    }
    if (typeof props['onSubmitEditing'] === 'function') {
      bindings.set('onSubmitEditing', {
        type: 'keydown',
        capture: false,
        call: (event) => {
          if ((event as KeyboardEvent).key === 'Enter')
            (instance.props['onSubmitEditing'] as (text: string) => void)(
              instance.node.value,
            );
        },
      });
    }
  }
  return bindings;
}

function updateListeners(instance: NodeInstance, props: Props): void {
  const wanted = eventBindings(instance, props);
  for (const [name, bound] of instance.listeners) {
    const next = wanted.get(name);
    if (next?.type === bound.type && next.capture === bound.capture) continue;
    instance.node.removeEventListener(
      bound.type,
      bound.listener,
      bound.capture,
    );
    instance.listeners.delete(name);
  }
  for (const [name, binding] of wanted) {
    if (instance.listeners.has(name)) continue;
    // Calls whatever the prop is now, so updates need no re-binding.
    const listener = (event: Event) =>
      prioritized(binding.type, () => binding.call(event));
    instance.node.addEventListener(binding.type, listener, binding.capture);
    instance.listeners.set(name, {
      type: binding.type,
      capture: binding.capture,
      listener,
    });
  }
}

// ── Props ───────────────────────────────────────────────────────────────────

function styleOf(instance: NodeInstance, props: Props): Style {
  const style: Record<string, unknown> = { ...flattenStyle(props['style']) };
  if (instance.type === HostTypes.Text && props['numberOfLines'] !== undefined)
    style['numberOfLines'] = props['numberOfLines'];
  if (instance.hidden) style['display'] = 'none';
  return style as Style;
}

function sameStyle(a: Style, b: Style): boolean {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  let count = 0;
  for (const key in right) {
    if (!Object.hasOwn(right, key)) continue;
    if (!Object.hasOwn(left, key)) return false;
    if (
      left[key] !== right[key] &&
      (key !== 'transform' ||
        JSON.stringify(left[key]) !== JSON.stringify(right[key]))
    )
      return false;
    count++;
  }
  for (const key in left) if (Object.hasOwn(left, key)) count--;
  return count === 0;
}

/** Sets the node's style, remembering it (only once the node took it). */
function setStyle(instance: NodeInstance, style: Style): void {
  instance.node.style = style;
  instance.style = style;
}

/**
 * Whether the accessibility props are the same: the same primitives. An
 * object (a state, a value, actions) may have changed inside, so it is
 * compared by what it says instead.
 */
function sameAccessibilityProps(previous: Props, next: Props): boolean {
  for (const prop in ACCESSIBILITY_PROPS) {
    const value = next[prop];
    if (value !== previous[prop]) return false;
    if (typeof value === 'object' && value !== null) return false;
  }
  return true;
}

/**
 * Whether the same props are functions: listeners call the prop as it is
 * now, so only which handlers there are needs listeners added or removed.
 */
function sameHandlers(previous: Props, next: Props): boolean {
  for (const name in next) {
    if (
      typeof next[name] === 'function' &&
      typeof previous[name] !== 'function'
    )
      return false;
  }
  for (const name in previous) {
    if (
      typeof previous[name] === 'function' &&
      typeof next[name] !== 'function'
    )
      return false;
  }
  return true;
}

/** Compare description data; node targets retain identity rather than being traversed. */
function sameAnimation(left: unknown, right: unknown, depth = 0): boolean {
  if (Object.is(left, right)) return true;
  if (depth > 64) return false;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object')
    return false;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) =>
        sameAnimation(value, right[index], depth + 1),
      )
    );
  if (
    Object.getPrototypeOf(left) !== Object.prototype ||
    Object.getPrototypeOf(right) !== Object.prototype
  )
    return false;
  const a = left as Record<string, unknown>,
    b = right as Record<string, unknown>;
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every(
      (key) =>
        Object.hasOwn(b, key) &&
        (key === 'target'
          ? a[key] === b[key]
          : sameAnimation(a[key], b[key], depth + 1)),
    )
  );
}

function applyProps(
  instance: NodeInstance,
  previous: Props | null,
  next: Props,
): void {
  const { node } = instance;
  instance.props = next;
  if (previous === null || next[SCOPE_PROP] !== previous[SCOPE_PROP])
    tagScope(node, (next[SCOPE_PROP] as Scope | undefined) ?? null);
  const explicit = next[ANIMATION_PROP] as
    | readonly AnimationKeyframe[]
    | AnimationDescription
    | undefined;
  const previousExplicit = previous?.[ANIMATION_PROP];
  const transition = next[TRANSITION_PROP] as AnimationOptions | undefined;
  if (
    explicit === undefined &&
    (previousExplicit !== undefined || transition === undefined)
  ) {
    instance.animation?.cancel();
    instance.animation = null;
  }
  const style = styleOf(instance, next);
  if (instance.style === null || !sameStyle(instance.style, style)) {
    if (
      instance.style !== null &&
      transition !== undefined &&
      explicit === undefined
    ) {
      const target: AnimationKeyframe = {};
      if (instance.style.opacity !== style.opacity)
        target.opacity = style.opacity ?? 1;
      if (
        JSON.stringify(instance.style.transform) !==
        JSON.stringify(style.transform)
      )
        target.transform = style.transform ?? [];
      if (instance.style.backgroundColor !== style.backgroundColor)
        target.backgroundColor = style.backgroundColor ?? 'transparent';
      if (instance.style.borderColor !== style.borderColor)
        target.borderColor = style.borderColor ?? 'black';
      if (Object.keys(target).length !== 0) {
        // Take the current presentation before publishing the new base style.
        // The native override is installed in this same commit, before paint.
        target.opacity = style.opacity ?? 1;
        target.transform = style.transform ?? [];
        instance.animation = node.animate([target], {
          ...transition,
          fill: 'both',
        });
      }
    } else if (transition === undefined && instance.animation !== null) {
      instance.animation.cancel();
      instance.animation = null;
    }
    setStyle(instance, style);
  }

  if (
    explicit !== undefined &&
    (!sameAnimation(explicit, previousExplicit) ||
      !sameAnimation(transition, previous?.[TRANSITION_PROP]))
  ) {
    // Mount style first, then submit in the same commit before the first paint.
    instance.animation = node.animate(explicit, transition);
  }

  if (
    next['focusable'] !== previous?.['focusable'] &&
    next['focusable'] !== undefined
  )
    node.focusable = Boolean(next['focusable']);

  if (previous === null || !sameAccessibilityProps(previous, next)) {
    const accessibility = accessibilityOf(next);
    const key = JSON.stringify(accessibility);
    if (key !== instance.accessibility) {
      node.accessibility = accessibility;
      instance.accessibility = key;
    }
  }

  switch (instance.type) {
    case HostTypes.Image:
      if (next['source'] !== previous?.['source'])
        node.source = (next['source'] as typeof node.source | undefined) ?? '';
      break;
    case HostTypes.Canvas:
      // Setting a size clears the canvas: only when it changes.
      for (const side of ['width', 'height'] as const) {
        const size = next[side];
        if (
          size !== undefined &&
          size !== previous?.[side] &&
          node[side] !== size
        )
          node[side] = Number(size);
      }
      break;
    case HostTypes.TextInput: {
      if (next['placeholder'] !== previous?.['placeholder'])
        node.placeholder = String(next['placeholder'] ?? '');
      const value = next['value'];
      // Controlled: follow the prop, without moving a caret that is fine.
      if (value !== undefined && value !== null && String(value) !== node.value)
        node.value = String(value);
      else if (previous === null && next['defaultValue'] !== undefined)
        node.value = String(next['defaultValue']);
      break;
    }
    default:
      break;
  }
  if (previous === null || !sameHandlers(previous, next))
    updateListeners(instance, next);
}

// ── Text ────────────────────────────────────────────────────────────────────

function flatten(spans: readonly Span[]): string {
  let text = '';
  for (const span of spans) {
    if (span.hidden) continue;
    text += span.text ?? flatten(span.spans);
  }
  return text;
}

/** Shows a text node's spans, after any change to them. */
function refreshText(owner: NodeInstance | SpanInstance | null): void {
  let at = owner;
  while (at !== null && at.kind === 'span') at = at.parent;
  if (at !== null && at.type === HostTypes.Text)
    at.node.text = flatten(at.spans);
}

function insertSpan(
  parent: NodeInstance | SpanInstance,
  child: SpanInstance,
  before: SpanInstance | null,
): void {
  const existing = parent.spans.indexOf(child);
  if (existing >= 0) parent.spans.splice(existing, 1);
  const index = before === null ? -1 : parent.spans.indexOf(before);
  if (index < 0) parent.spans.push(child);
  else parent.spans.splice(index, 0, child);
  child.parent = parent;
  refreshText(parent);
}

function removeSpan(
  parent: NodeInstance | SpanInstance,
  child: SpanInstance,
): void {
  const index = parent.spans.indexOf(child);
  if (index >= 0) parent.spans.splice(index, 1);
  child.parent = null;
  refreshText(parent);
}

// ── Tree ────────────────────────────────────────────────────────────────────

function createNode(type: HostType): UiNode {
  switch (type) {
    case HostTypes.View:
      return createView();
    case HostTypes.Text:
      return createText();
    case HostTypes.Image:
      return createImage();
    case HostTypes.ScrollView:
      return createScrollView();
    case HostTypes.TextInput:
      return createTextInput();
    case HostTypes.Canvas:
      return createCanvas();
  }
}

function insert(
  parent: Instance | UiNode,
  child: Instance,
  before: Instance | null,
): void {
  if (child.kind === 'span') {
    if (parent instanceof NodeInstance || parent instanceof SpanInstance)
      insertSpan(parent, child, before as SpanInstance | null);
    return;
  }
  const parentNode =
    parent instanceof NodeInstance ? parent.node : (parent as UiNode);
  parentNode.insertBefore(
    child.node,
    before !== null && before.kind === 'node' ? before.node : null,
  );
}

function cancelAnimations(node: UiNode): void {
  const instance = instancesByNode.get(node);
  instance?.animation?.cancel();
  if (instance) instance.animation = null;
  for (const child of node.children) cancelAnimations(child);
}

function remove(parent: Instance | UiNode, child: Instance): void {
  if (child.kind === 'span') {
    if (parent instanceof NodeInstance || parent instanceof SpanInstance)
      removeSpan(parent, child);
    return;
  }
  cancelAnimations(child.node);
  child.node.remove();
}

const NotPendingTransition = null;
const HostTransitionContext: ReactContext<unknown> = createContext<unknown>(
  null,
) as unknown as ReactContext<unknown>;

/** The host config, for react-reconciler. */
export const hostConfig = {
  rendererPackageName: '@soundor/react',
  rendererVersion: '0.2.0',
  extraDevToolsConfig: null,

  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  supportsResources: false,
  supportsSingletons: false,
  supportsTestSelectors: false,
  supportsMicrotasks: true,
  isPrimaryRenderer: true,
  warnsIfNotActing: false,

  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,
  scheduleMicrotask: queueMicrotask,

  getRootHostContext: (): HostContext => ({ insideText: false }),
  getChildHostContext: (parent: HostContext, type: HostType): HostContext => {
    const insideText = type === HostTypes.Text;
    return parent.insideText === insideText ? parent : { insideText };
  },

  createInstance(
    type: HostType,
    props: Props,
    _root: UiNode,
    context: HostContext,
  ): Instance {
    if (context.insideText) {
      if (type !== HostTypes.Text)
        throw new Error(`<${hostName(type)}> cannot be inside <Text>`);
      return new SpanInstance(null);
    }
    const instance = new NodeInstance(type, createNode(type), props);
    applyProps(instance, null, props);
    return instance;
  },

  createTextInstance(
    text: string,
    _root: UiNode,
    context: HostContext,
  ): Instance {
    if (!context.insideText) {
      throw new Error(
        `Text strings must be rendered within a <Text> component: "${text}"`,
      );
    }
    return new SpanInstance(text);
  },

  appendInitialChild: (parent: Instance, child: Instance) =>
    insert(parent, child, null),
  finalizeInitialChildren: () => false,
  shouldSetTextContent: () => false,
  getPublicInstance: (instance: Instance) =>
    instance.kind === 'node' ? instance.node : null,

  prepareForCommit: () => null,
  resetAfterCommit: () => {},
  preparePortalMount: () => {},

  appendChild: (parent: Instance, child: Instance) =>
    insert(parent, child, null),
  appendChildToContainer: (container: UiNode, child: Instance) =>
    insert(container, child, null),
  insertBefore: (parent: Instance, child: Instance, before: Instance) =>
    insert(parent, child, before),
  insertInContainerBefore: (
    container: UiNode,
    child: Instance,
    before: Instance,
  ) => insert(container, child, before),
  removeChild: (parent: Instance, child: Instance) => remove(parent, child),
  removeChildFromContainer: (container: UiNode, child: Instance) =>
    remove(container, child),
  clearContainer: (container: UiNode) => {
    for (const child of container.children) {
      cancelAnimations(child);
      child.remove();
    }
  },

  commitUpdate(
    instance: Instance,
    _type: HostType,
    previous: Props,
    next: Props,
  ): void {
    if (instance.kind === 'node') applyProps(instance, previous, next);
  },
  commitTextUpdate(span: SpanInstance, _previous: string, next: string): void {
    span.text = next;
    refreshText(span);
  },
  resetTextContent: () => {},
  commitMount: () => {},

  hideInstance(instance: Instance): void {
    instance.hidden = true;
    if (instance.kind === 'node')
      setStyle(instance, styleOf(instance, instance.props));
    else refreshText(instance);
  },
  unhideInstance(instance: Instance): void {
    instance.hidden = false;
    if (instance.kind === 'node')
      setStyle(instance, styleOf(instance, instance.props));
    else refreshText(instance);
  },
  hideTextInstance(span: SpanInstance): void {
    span.hidden = true;
    refreshText(span);
  },
  unhideTextInstance(span: SpanInstance): void {
    span.hidden = false;
    refreshText(span);
  },

  // Detached nodes are released when garbage collected.
  detachDeletedInstance: (instance: Instance) => {
    if (instance.kind === 'node') cancelAnimations(instance.node);
  },

  setCurrentUpdatePriority: (priority: number) => {
    currentUpdatePriority = priority;
  },
  getCurrentUpdatePriority: () => currentUpdatePriority,
  resolveUpdatePriority: () =>
    currentUpdatePriority !== NoEventPriority
      ? currentUpdatePriority
      : currentEventPriority,
  getCurrentEventPriority: () => currentEventPriority,
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent: () => {},
  requestPostPaintCallback: () => {},

  maySuspendCommit: () => false,
  maySuspendCommitOnUpdate: () => false,
  maySuspendCommitInSyncRender: () => false,
  preloadInstance: () => true,
  startSuspendingCommit: () => {},
  suspendInstance: () => {},
  waitForCommitToBeReady: () => null,
  getSuspendedCommitReason: () => null,

  NotPendingTransition,
  HostTransitionContext,
  resetFormInstance: () => {},

  getInstanceFromNode: () => null,
  getInstanceFromScope: () => null,
  prepareScopeUpdate: () => {},
  beforeActiveInstanceBlur: () => {},
  afterActiveInstanceBlur: () => {},
  bindToConsole: (
    method: 'log' | 'info' | 'warn' | 'error' | 'debug',
    args: unknown[],
  ) => Function.prototype.bind.call(console[method], console, ...args),
};

function hostName(type: HostType): string {
  for (const [name, host] of Object.entries(HostTypes))
    if (host === type) return name;
  return type;
}
