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
  createImage,
  createScrollView,
  createText,
  createTextInput,
  createView,
  type KeyboardEvent,
  type Style,
  type UiNode,
} from 'soundor:ui';

import { flattenStyle } from './style';

/** The host element types the components render. */
export const HostTypes = {
  View: 'soundor-view',
  Text: 'soundor-text',
  Image: 'soundor-image',
  ScrollView: 'soundor-scroll',
  TextInput: 'soundor-input',
} as const;

export type HostType = (typeof HostTypes)[keyof typeof HostTypes];

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

  constructor(
    readonly type: HostType,
    readonly node: UiNode,
    public props: Props,
  ) {}
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

/** Runs a listener with the update priority its event deserves. */
function prioritized(type: string, run: () => void): void {
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
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) =>
        (a as Record<string, unknown>)[key] ===
        (b as Record<string, unknown>)[key],
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
  const style = styleOf(instance, next);
  if (previous === null || !sameStyle(node.style, style)) node.style = style;

  if (
    next['focusable'] !== previous?.['focusable'] &&
    next['focusable'] !== undefined
  )
    node.focusable = Boolean(next['focusable']);

  switch (instance.type) {
    case HostTypes.Image:
      if (next['source'] !== previous?.['source'])
        node.source = (next['source'] as typeof node.source | undefined) ?? '';
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

function remove(parent: Instance | UiNode, child: Instance): void {
  if (child.kind === 'span') {
    if (parent instanceof NodeInstance || parent instanceof SpanInstance)
      removeSpan(parent, child);
    return;
  }
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
    for (const child of container.children) child.remove();
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
      instance.node.style = styleOf(instance, instance.props);
    else refreshText(instance);
  },
  unhideInstance(instance: Instance): void {
    instance.hidden = false;
    if (instance.kind === 'node')
      instance.node.style = styleOf(instance, instance.props);
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
  detachDeletedInstance: () => {},

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
