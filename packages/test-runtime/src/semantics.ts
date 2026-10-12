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
export function semanticTree(roots: readonly TestNode[]): SemanticNode[] {
  const owned = new Map<TestNode, TestNode[]>(),
    relocated = new Set<TestNode>();
  const walk = (node: TestNode, call: (node: TestNode) => void) => {
    call(node);
    for (const child of node.children) walk(child, call);
  };
  for (const root of roots)
    walk(root, (node) => {
      const owner = node.accessibilityParent;
      if (!owner?.isConnected) return;
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
    hidden ||= node.style.display === 'none';
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
    const kept = new Set<SemanticNode>();
    const collect = (entry: SemanticNode) => {
      kept.add(entry);
      entry.children.forEach(collect);
    };
    collect(modal);
    order.forEach((entry) => {
      if (!kept.has(entry)) entry.hidden = true;
    });
  }
  return result;
}
