import type { TestNode } from './node';
import type {
  AccessibilityState,
  AccessibilityValue,
  AccessibilityRole,
} from './types';
export type SemanticRole =
  | Exclude<AccessibilityRole, 'none'>
  | 'group'
  | 'textinput'
  | 'scrollview';
export interface SemanticNode {
  node: TestNode;
  role: SemanticRole;
  name: string;
  description: string;
  state: AccessibilityState;
  value: AccessibilityValue;
  hidden: boolean;
  children: SemanticNode[];
}
const LEAVES = new Set([
  'text',
  'image',
  'button',
  'link',
  'adjustable',
  'checkbox',
  'switch',
  'togglebutton',
  'radio',
  'progressbar',
  'combobox',
  'menuitem',
  'scrollbar',
  'spinbutton',
  'tab',
  'header',
  'keyboardkey',
  'timer',
  'textinput',
]);
/** Soundor semantic ownership, including portals and the last visible modal. */
export function semanticSnapshot(roots: readonly TestNode[]): {
  tree: SemanticNode[];
  hidden: Set<TestNode>;
  activeModal: TestNode | null;
} {
  const hiddenNodes = new Set<TestNode>(),
    allNodes: TestNode[] = [];
  const indexDisplay = (node: TestNode, hidden = false) => {
    hidden ||= node.style.display === 'none';
    allNodes.push(node);
    if (hidden) hiddenNodes.add(node);
    for (const child of node.children) indexDisplay(child, hidden);
  };
  roots.forEach((root) => indexDisplay(root));
  const owned = new Map<TestNode, TestNode[]>(),
    relocated = new Set<TestNode>();
  const walk = (node: TestNode, call: (node: TestNode) => void) => {
    call(node);
    for (const child of node.children) walk(child, call);
  };
  for (const root of roots)
    walk(root, (node) => {
      const owner = node.accessibilityParent;
      if (!owner?.isConnected || owner.runtime !== node.runtime) return;
      const seen = new Set([node]);
      for (
        let at: TestNode | null = owner;
        at;
        at = at.accessibilityParent ?? at.parent
      ) {
        if (seen.has(at)) return;
        seen.add(at);
      }
      relocated.add(node);
      owned.set(owner, [...(owned.get(owner) ?? []), node]);
    });
  const children = (node: TestNode) => [
    ...node.children.filter((child) => !relocated.has(child)),
    ...(owned.get(node) ?? []),
  ];
  const text = (node: TestNode): string =>
    children(node)
      .filter((child) => child.style.display !== 'none')
      .map(
        (child) =>
          child.accessibility.label ||
          (child.type === 'text' ? child.text : '') ||
          text(child),
      )
      .filter(Boolean)
      .map((x) => x.trim())
      .join(' ');
  const order: SemanticNode[] = [];
  const visit = (node: TestNode, hidden: boolean): SemanticNode[] => {
    hidden ||= hiddenNodes.has(node);
    const a = node.accessibility;
    const element =
      a.accessible ??
      (a.modal ||
        (a.role !== undefined
          ? a.role !== 'none'
          : Boolean(a.label) ||
            (node.type === 'text' && node.text !== '') ||
            node.type === 'input'));
    if (!element)
      return children(node).flatMap((child) => visit(child, hidden));
    const role: SemanticRole =
      a.role && a.role !== 'none'
        ? a.role
        : a.modal
          ? 'dialog'
          : (
              {
                text: 'text',
                image: 'image',
                canvas: 'image',
                input: 'textinput',
                scroll: 'scrollview',
                view: 'group',
              } as const
            )[node.type];
    const entry: SemanticNode = {
      node,
      role,
      name: a.label || (node.type === 'text' ? node.text : text(node)),
      description: a.hint ?? '',
      state: { ...a.state },
      value:
        node.type === 'input'
          ? { text: node.value, ...a.value }
          : { ...a.value },
      hidden,
      children: [],
    };
    order.push(entry);
    if (!LEAVES.has(role) && !(a.accessible === true && role === 'group'))
      entry.children = children(node).flatMap((child) => visit(child, hidden));
    return [entry];
  };
  const result = roots.flatMap((root) => visit(root, false));
  const modal = order.findLast(
    (entry) => entry.node.accessibility.modal && !entry.hidden,
  );
  if (modal) {
    const kept = new Set<TestNode>();
    const collect = (node: TestNode) => {
      kept.add(node);
      children(node).forEach(collect);
    };
    collect(modal.node);
    for (const node of allNodes) if (!kept.has(node)) hiddenNodes.add(node);
    for (const entry of order) entry.hidden ||= hiddenNodes.has(entry.node);
  }
  return {
    tree: result,
    hidden: hiddenNodes,
    activeModal: modal?.node ?? null,
  };
}
export function semanticTree(roots: readonly TestNode[]): SemanticNode[] {
  return semanticSnapshot(roots).tree;
}
