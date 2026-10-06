/**
 * Portals: React children rendered at another place in the plugin view,
 * through the reconciler's own portals, so context, state and effects stay
 * those of the declaring component.
 *
 * By default a portal is an overlay: an entry in the view's overlay layer
 * (soundor:ui's overlayRoot), above all of the content. Entries stack in the
 * order they were opened. Given a host, a portal renders into that host's
 * node instead, and so is clipped, stacked and scrolled wherever it is.
 *
 * To assistive technology, an overlay belongs where it was opened: an
 * overlay opened from inside another (a menu from a modal) is read as part
 * of it (its node's accessibilityParent). A hosted portal is read where its
 * host is.
 */

import {
  createContext,
  createElement,
  useContext,
  useInsertionEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  createView,
  overlayRoot,
  type Accessibility,
  type Style,
  type UiNode,
} from 'soundor:ui';

import { View } from './components';
import { reconciler } from './root';
import type { StyleProp } from './style';

/** The reconciler's portal into `node` (its types predate React 19's). */
function portal(children: ReactNode, node: UiNode): ReactNode {
  return reconciler.createPortal(children, node, null) as unknown as ReactNode;
}

// ── Hosts ─────────────────────────────────────────────────────────────────────

declare const opaque: unique symbol;

/** Where a portal renders: made by createPortalHost(), shown by Portal.Host. */
export interface PortalHost {
  readonly [opaque]: true;
}

/** The node a host is mounted as, if it is, and who waits for it. */
class HostState {
  node: UiNode | null = null;
  readonly #listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly get = (): UiNode | null => this.node;

  set(node: UiNode | null): void {
    this.node = node;
    for (const listener of [...this.#listeners]) listener();
  }
}

const hosts = new WeakMap<PortalHost, HostState>();

function stateOf(host: PortalHost): HostState {
  const state = hosts.get(host);
  if (state === undefined)
    throw new TypeError('host must be a PortalHost from createPortalHost()');
  return state;
}

/** A new place to render portals into; show it with `<Portal.Host>`. */
export function createPortalHost(): PortalHost {
  const host = Object.freeze(Object.create(null) as PortalHost);
  hosts.set(host, new HostState());
  return host;
}

export interface PortalHostProps {
  host: PortalHost;
  style?: StyleProp;
}

/**
 * A view where portals given `host` render, as its children. One host shows
 * in one place at a time.
 */
function Host({ host, style }: PortalHostProps): ReactNode {
  const state = stateOf(host);
  const [node, setNode] = useState<UiNode | null>(null);
  useLayoutEffect(() => {
    if (node === null) return undefined;
    if (state.node !== null && state.node !== node) {
      throw new Error(
        'A PortalHost is shown by two <Portal.Host> at once; show it in one place',
      );
    }
    state.set(node);
    return () => {
      if (state.node === node) state.set(null);
    };
  }, [state, node]);
  return createElement(View, { style, ref: setNode });
}

function HostedPortal({
  host,
  children,
}: {
  host: PortalHost;
  children?: ReactNode;
}): ReactNode {
  const state = stateOf(host);
  const node = useSyncExternalStore(state.subscribe, state.get);
  // Nothing to show until the host is: no physical content meanwhile.
  return node === null ? null : portal(children, node);
}

// ── Overlays ──────────────────────────────────────────────────────────────────

/** An overlay entry fills the view and lets the pointer through. */
const ENTRY_STYLE: Style = {
  position: 'absolute',
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  pointerEvents: 'box-none',
};

/** When each entry was opened: later ones stack above. */
const opened = new WeakMap<UiNode, number>();
let openings = 0;

/** The overlay entry components render in; null outside every overlay. */
const EntryContext = createContext<UiNode | null>(null);

export interface OverlayEntryProps {
  children?: ReactNode;
  /** The entry's own accessibility (a modal's dialog). */
  accessibility?: Accessibility;
}

/** Tells assistive technology what an entry is, and where it belongs. */
function describeEntry(
  entry: UiNode,
  owner: UiNode | null,
  accessibility: string,
): void {
  entry.accessibilityParent = owner;
  entry.accessibility = JSON.parse(accessibility) as Accessibility;
}

/** An entry of the overlay layer, holding `children`. */
export function OverlayEntry({
  children,
  accessibility,
}: OverlayEntryProps): ReactNode {
  // An overlay opened from inside another is read as part of it.
  const owner = useContext(EntryContext);
  // Numbered while rendering, so an overlay opened by another one, in the
  // same commit, still stacks above it.
  const [entry] = useState(() => {
    const node = createView(ENTRY_STYLE);
    opened.set(node, ++openings);
    return node;
  });
  // Before any layout effect: what the children measure or focus there is
  // already in the view.
  useInsertionEffect(() => {
    const order = opened.get(entry)!;
    const above =
      overlayRoot.children.find((node) => (opened.get(node) ?? 0) > order) ??
      null;
    overlayRoot.insertBefore(entry, above);
    return () => entry.remove();
  }, [entry]);
  const semantics = JSON.stringify(accessibility ?? {});
  useInsertionEffect(
    () => describeEntry(entry, owner, semantics),
    [entry, owner, semantics],
  );
  return createElement(
    EntryContext.Provider,
    { value: entry },
    portal(children, entry),
  );
}

// ── Portal ────────────────────────────────────────────────────────────────────

export interface PortalProps {
  children?: ReactNode;
  /** Where to render: a custom host, or (null, undefined) the overlay. */
  host?: PortalHost | null;
}

function PortalComponent({ children, host }: PortalProps): ReactNode {
  return host === null || host === undefined
    ? createElement(OverlayEntry, null, children)
    : createElement(HostedPortal, { host }, children);
}

/**
 * Renders its children elsewhere in the plugin view, keeping their React
 * context, state and effects.
 *
 * - `<Portal>`: above all of the content, in the view's coordinates, out of
 *   any clipping or scrolling; a later portal stacks above an earlier one.
 * - `<Portal host={host}>`: inside the `<Portal.Host host={host}>`, as its
 *   children: clipped, stacked and scrolled as they are.
 *
 * Pointer and key events bubble through the nodes as shown, not through the
 * component that declared the portal.
 */
export const Portal: ((props: PortalProps) => ReactNode) & {
  Host: (props: PortalHostProps) => ReactNode;
} = Object.assign(PortalComponent, { Host });
