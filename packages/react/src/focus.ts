/**
 * FocusScope: a logical boundary for keyboard focus, with no node of its own.
 *
 * Membership is logical, not physical: every node a component renders is
 * tagged with the FocusScope it was rendered in (React context, which also
 * flows through portals), and a scope knows the scope it was rendered in.
 * So content rendered elsewhere in the view still belongs to the scope that
 * rendered it.
 */

import {
  createContext,
  createElement,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  focusedNode,
  root,
  type FocusEvent,
  type KeyboardEvent,
  type UiNode,
} from 'soundor:ui';

/** A FocusScope's place in the logical tree of scopes. */
export class Scope {
  /** The member that last had focus while the scope trapped it. */
  lastFocused: UiNode | null = null;

  constructor(readonly parent: Scope | null) {}

  /** Whether `other` is this scope or nested in it. */
  contains(other: Scope | null): boolean {
    for (let at = other; at !== null; at = at.parent)
      if (at === this) return true;
    return false;
  }
}

/** The scope components render in; null outside every FocusScope. */
export const ScopeContext = createContext<Scope | null>(null);

/** The scope each node was rendered in (null: in none). */
const scopeOfNode = new WeakMap<UiNode, Scope | null>();

/** Records the scope a component rendered `node` in. */
export function tagScope(node: UiNode, scope: Scope | null): void {
  scopeOfNode.set(node, scope);
}

/**
 * The scope of `node`: its own, or (for nodes made outside React) that of
 * the nearest ancestor rendered by a component.
 */
function scopeOf(node: UiNode): Scope | null {
  for (let at: UiNode | null = node; at !== null; at = at.parent) {
    const scope = scopeOfNode.get(at);
    if (scope !== undefined) return scope;
  }
  return null;
}

function within(node: UiNode, scope: Scope): boolean {
  return scope.contains(scopeOf(node));
}

// ── The view's trees ──────────────────────────────────────────────────────────

/** The root nodes focus can be in, in sequential order. */
const roots: UiNode[] = [root];

function displayed(node: UiNode): boolean {
  for (let at: UiNode | null = node; at !== null; at = at.parent)
    if (at.style.display === 'none') return false;
  return true;
}

function canFocus(node: UiNode | null): node is UiNode {
  return node !== null && node.isConnected && node.focusable && displayed(node);
}

/** The focusable members of `scope`, in sequential (tree) order. */
function members(scope: Scope): UiNode[] {
  const order: UiNode[] = [];
  const collect = (node: UiNode): void => {
    if (node.style.display === 'none') return;
    if (node.focusable && within(node, scope)) order.push(node);
    for (const child of node.children) collect(child);
  };
  for (const tree of roots) collect(tree);
  return order;
}

// ── Traps ─────────────────────────────────────────────────────────────────────

/** Active trapping scopes; the last one holds focus. */
const traps: Scope[] = [];
const listening = new WeakSet<UiNode>();
/** Set while a trap moves focus itself. */
let redirecting = false;

function activeTrap(): Scope | null {
  return traps.at(-1) ?? null;
}

/** Adds a trap below the traps nested in it, so the innermost one wins. */
function addTrap(scope: Scope): void {
  for (const tree of roots) listen(tree);
  const nested = traps.findIndex((trap) => scope.contains(trap));
  if (nested < 0) traps.push(scope);
  else traps.splice(nested, 0, scope);
}

function removeTrap(scope: Scope): void {
  const index = traps.indexOf(scope);
  if (index >= 0) traps.splice(index, 1);
}

function listen(tree: UiNode): void {
  if (listening.has(tree)) return;
  listening.add(tree);
  tree.addEventListener('keydown', onKeyDown);
  tree.addEventListener('focus', onFocus, true);
}

/** Tab and Shift+Tab cycle through the trapping scope's members only. */
function onKeyDown(event: KeyboardEvent): void {
  const trap = activeTrap();
  if (trap === null || event.defaultPrevented || event.key !== 'Tab') return;
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  // The runtime would move focus through the whole view.
  event.preventDefault();
  const order = members(trap);
  if (order.length === 0) return;
  const current = focusedNode();
  const index = current === null ? -1 : order.indexOf(current);
  const next =
    index < 0
      ? event.shiftKey
        ? order.length - 1
        : 0
      : (index + (event.shiftKey ? order.length - 1 : 1)) % order.length;
  order[next]!.focus();
}

/** Focus that leaves the trapping scope is taken back into it. */
function onFocus(event: FocusEvent): void {
  const trap = activeTrap();
  const target = event.target;
  if (trap === null || target === null || redirecting) return;
  if (within(target, trap)) {
    trap.lastFocused = target;
    return;
  }
  // The node outside never hears of it.
  event.stopPropagation();
  redirecting = true;
  try {
    const back = canFocus(trap.lastFocused)
      ? trap.lastFocused
      : (members(trap)[0] ?? null);
    if (back !== null) back.focus();
    else target.blur();
  } finally {
    redirecting = false;
  }
}

// ── The component ────────────────────────────────────────────────────────────

export interface FocusScopeProps {
  children?: ReactNode;
  /**
   * Keeps focus inside: Tab and Shift+Tab cycle through the scope's
   * focusable nodes, and focus moved outside comes back. The innermost
   * trapping scope wins.
   */
  trapped?: boolean;
  /** On mount, focuses the first focusable node unless focus is inside. */
  autoFocus?: boolean;
  /** On unmount, gives focus back to the node that had it on mount. */
  restoreFocus?: boolean;
}

/**
 * A boundary for keyboard focus around its children. It adds no node: the
 * layout is as if the children were rendered without it. Everything its
 * children render belongs to it, wherever in the view it shows.
 */
export function FocusScope({
  children,
  trapped = false,
  autoFocus = false,
  restoreFocus = false,
}: FocusScopeProps): ReactNode {
  const parent = useContext(ScopeContext);
  const [scope] = useState(() => new Scope(parent));
  // What the scope does on mount and unmount is decided on mount. Focus is
  // read while rendering, before this commit (or a nested scope's
  // autoFocus) can move it.
  const [mount] = useState(() => ({
    autoFocus,
    restoreFocus,
    restoreTo: restoreFocus ? focusedNode() : null,
  }));

  // Declared first: on unmount the trap goes before focus is restored.
  useLayoutEffect(() => {
    if (!trapped) return undefined;
    addTrap(scope);
    return () => removeTrap(scope);
  }, [scope, trapped]);

  // Once, on mount; layout effects run when the children are in the view.
  useLayoutEffect(() => {
    if (mount.autoFocus) {
      const current = focusedNode();
      if (current === null || !within(current, scope))
        members(scope)[0]?.focus();
    }
    return () => {
      if (!mount.restoreFocus) return;
      // Only when focus is still ours to give back.
      const current = focusedNode();
      if (current !== null && !within(current, scope)) return;
      if (canFocus(mount.restoreTo)) mount.restoreTo.focus();
    };
  }, [scope, mount]);

  return createElement(ScopeContext.Provider, { value: scope }, children);
}
