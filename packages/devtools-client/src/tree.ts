import type { DebugNode } from '@soundor/devtools-protocol';
export function label(node: DebugNode) {
  return `${node.type}${node.debugId ? ` #${node.debugId}` : ''}${node.text ? ` "${node.text.slice(0, 90)}"` : ''}`;
}

export function searchable(node: DebugNode) {
  return [
    node.type,
    node.debugId,
    node.ref.id,
    node.text,
    node.accessibility?.role,
    node.accessibility?.name,
  ]
    .join(' ')
    .toLowerCase();
}
export function filterTree(
  nodes: Map<string, DebugNode>,
  query: string,
): Set<string> | undefined {
  let matches: Set<string> | undefined;
  if (query) {
    matches = new Set();
    for (const node of nodes.values()) {
      if (!searchable(node).includes(query)) continue;
      let ancestor: DebugNode | undefined = node;
      const seen = new Set();
      while (ancestor && !seen.has(ancestor.ref.id)) {
        seen.add(ancestor.ref.id);
        matches.add(ancestor.ref.id);
        ancestor = ancestor.parent ? nodes.get(ancestor.parent) : undefined;
      }
    }
  }
  return matches;
}
