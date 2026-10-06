/**
 * soundor:ui for tests in Node: the same tree semantics, kept in JavaScript,
 * with DOM-style capture and bubble dispatch. Plus helpers to fire events and
 * to print the tree.
 */

type Listener = { call: (event: FakeEvent) => void; capture: boolean };

export class FakeEvent {
  target: FakeNode | null = null;
  currentTarget: FakeNode | null = null;
  defaultPrevented = false;
  stopped = false;
  [key: string]: unknown;

  constructor(
    readonly type: string,
    init: Record<string, unknown> = {},
    readonly bubbles = true,
  ) {
    Object.assign(this, init);
  }

  preventDefault() {
    this.defaultPrevented = true;
  }

  stopPropagation() {
    this.stopped = true;
  }
}

let nextId = 1;

export class FakeNode {
  readonly id = nextId++;
  parent: FakeNode | null = null;
  readonly kids: FakeNode[] = [];
  style: Record<string, unknown> = {};
  text = '';
  placeholder = '';
  source = '';
  focusable: boolean;
  accessibility: Record<string, unknown> = {};
  accessibilityParent: FakeNode | null = null;
  readonly listeners = new Map<string, Listener[]>();

  constructor(readonly type: string) {
    this.focusable = type === 'input';
  }

  get children(): readonly FakeNode[] {
    return [...this.kids];
  }

  get isConnected(): boolean {
    return (
      this === root ||
      this === overlayRoot ||
      (this.parent?.isConnected ?? false)
    );
  }

  get focused(): boolean {
    return focusedNode() === this;
  }

  focus() {
    moveFocus(this);
  }

  blur() {
    if (this.focused) moveFocus(null);
  }

  get value(): string {
    return this.text;
  }

  set value(value: string) {
    this.text = value;
  }

  appendChild(child: FakeNode) {
    return this.insertBefore(child, null);
  }

  insertBefore(child: FakeNode, before: FakeNode | null) {
    if (this.type === 'text' || this.type === 'image' || this.type === 'input')
      throw new TypeError('only views can have children');
    child.remove();
    const index = before === null ? -1 : this.kids.indexOf(before);
    if (index < 0) this.kids.push(child);
    else this.kids.splice(index, 0, child);
    child.parent = this;
    return child;
  }

  removeChild(child: FakeNode) {
    this.kids.splice(this.kids.indexOf(child), 1);
    child.parent = null;
    return child;
  }

  remove() {
    this.parent?.removeChild(this);
  }

  addEventListener(
    type: string,
    call: (event: FakeEvent) => void,
    capture?: boolean,
  ) {
    const list = this.listeners.get(type) ?? [];
    list.push({ call, capture: Boolean(capture) });
    this.listeners.set(type, list);
  }

  removeEventListener(
    type: string,
    call: (event: FakeEvent) => void,
    capture?: boolean,
  ) {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter(
        (entry) => entry.call !== call || entry.capture !== Boolean(capture),
      ),
    );
  }

  dispatchEvent(event: FakeEvent): boolean {
    const path: FakeNode[] = [];
    for (let node: FakeNode | null = this; node; node = node.parent)
      path.push(node);
    event.target = this;
    const run = (node: FakeNode, capture: boolean | null) => {
      event.currentTarget = node;
      for (const entry of [...(node.listeners.get(event.type) ?? [])])
        if (capture === null || entry.capture === capture) entry.call(event);
    };
    for (let i = path.length - 1; i > 0 && !event.stopped; --i)
      run(path[i]!, true);
    if (!event.stopped) run(this, null);
    if (event.bubbles)
      for (let i = 1; i < path.length && !event.stopped; ++i)
        run(path[i]!, false);
    return !event.defaultPrevented;
  }
}

export const root = new FakeNode('view');
export const overlayRoot = new FakeNode('view');

let focused: FakeNode | null = null;

export function focusedNode(): FakeNode | null {
  if (focused !== null && !focused.isConnected) focused = null;
  return focused;
}

/** The runtimes' focus(): blur, then focus; unfocusable nodes are ignored. */
function moveFocus(node: FakeNode | null) {
  if (node !== null && (!node.focusable || !node.isConnected)) return;
  const previous = focusedNode();
  if (previous === node) return;
  focused = node;
  previous?.dispatchEvent(
    new FakeEvent('blur', { relatedTarget: node }, false),
  );
  if (node !== null && focused === node)
    node.dispatchEvent(
      new FakeEvent('focus', { relatedTarget: previous }, false),
    );
}

/**
 * A key pressed: keydown at the focused node (or the root), then the
 * runtimes' default action for Tab, cycling focus in tree order.
 */
export function pressKey(key: string, init: Record<string, unknown> = {}) {
  const event = new FakeEvent('keydown', { key, ...init });
  (focusedNode() ?? root).dispatchEvent(event);
  if (event.defaultPrevented || key !== 'Tab') return event;
  const order: FakeNode[] = [];
  const collect = (node: FakeNode) => {
    if (node.style['display'] === 'none') return;
    if (node.focusable) order.push(node);
    for (const kid of node.kids) collect(kid);
  };
  collect(root);
  collect(overlayRoot);
  if (order.length === 0) return event;
  const index = order.indexOf(focusedNode()!);
  const back = Boolean(init['shiftKey']);
  const next =
    index < 0
      ? back
        ? order.length - 1
        : 0
      : (index + (back ? order.length - 1 : 1)) % order.length;
  moveFocus(order[next]!);
  return event;
}

export const createView = (style?: Record<string, unknown>) => {
  const node = new FakeNode('view');
  if (style !== undefined) node.style = style;
  return node;
};
export const createText = () => new FakeNode('text');
export const createImage = () => new FakeNode('image');
export const createScrollView = () => new FakeNode('scroll');
export const createTextInput = () => new FakeNode('input');

/** The handlers each pressable node was given, for tests to inspect. */
export const pressables = new Map<FakeNode, Record<string, unknown>>();

/** pressable() reduced to what the React layer relies on. */
export function pressable(
  node: FakeNode,
  handlers: {
    onPress?: (event: FakeEvent) => void;
    onLongPress?: (event: FakeEvent) => void;
    onPressIn?: (event: FakeEvent) => void;
    onPressOut?: (event: FakeEvent) => void;
    onStateChange?: (state: {
      pressed: boolean;
      hovered: boolean;
      focused: boolean;
    }) => void;
  },
) {
  const state = { pressed: false, hovered: false, focused: false };
  const change = (next: Partial<typeof state>) => {
    Object.assign(state, next);
    handlers.onStateChange?.({ ...state });
  };
  const down = (event: FakeEvent) => {
    change({ pressed: true });
    handlers.onPressIn?.(event);
  };
  const up = (event: FakeEvent) => {
    change({ pressed: false });
    handlers.onPressOut?.(event);
  };
  const click = (event: FakeEvent) => handlers.onPress?.(event);
  const act = (event: FakeEvent) => {
    if (event.target !== node || event.defaultPrevented) return;
    if (event['actionName'] === 'activate') {
      event.preventDefault();
      handlers.onPress?.(event);
    } else if (
      event['actionName'] === 'longpress' &&
      handlers.onLongPress !== undefined
    ) {
      event.preventDefault();
      handlers.onLongPress(event);
    }
  };
  const focus = () => change({ focused: true });
  const blur = () => change({ focused: false });
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointerup', up);
  node.addEventListener('click', click);
  node.addEventListener('accessibilityaction', act);
  node.addEventListener('focus', focus);
  node.addEventListener('blur', blur);
  node.focusable = true;
  pressables.set(node, handlers);
  return () => {
    node.removeEventListener('pointerdown', down);
    node.removeEventListener('pointerup', up);
    node.removeEventListener('click', click);
    node.removeEventListener('accessibilityaction', act);
    node.removeEventListener('focus', focus);
    node.removeEventListener('blur', blur);
    pressables.delete(node);
  };
}

/** Dispatches an event at `node`; returns it. */
export function fire(
  node: FakeNode,
  type: string,
  init: Record<string, unknown> = {},
) {
  const event = new FakeEvent(
    type,
    init,
    !['focus', 'blur', 'scroll'].includes(type),
  );
  node.dispatchEvent(event);
  return event;
}

/** The tree as text: `view{flex:1}[text"Hi"]`. */
export function print(node: FakeNode = root): string {
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

export function reset() {
  for (const kid of root.children) kid.remove();
  for (const kid of overlayRoot.children) kid.remove();
  focused = null;
}
