import type { DebugNode, DebugTarget, DebugTree } from '@soundor/driver';

/** How a node reads in one line: type, debug ID, text, role and name. */
export function nodeLabel(node: DebugNode): string {
  const parts = [node.type];
  if (node.debugId) parts.push(`#${node.debugId}`);
  if (node.text) parts.push(JSON.stringify(node.text.slice(0, 80)));
  const { role, name } = node.accessibility ?? {};
  if (typeof role === 'string' && role)
    parts.push(
      typeof name === 'string' && name
        ? `(${role} ${JSON.stringify(name.slice(0, 80))})`
        : `(${role})`,
    );
  parts.push(`[${node.ref.id}]`);
  if (!node.visible) parts.push('hidden');
  if (node.focused) parts.push('focused');
  return parts.join(' ');
}

export function formatTargets(targets: DebugTarget[]): string {
  if (targets.length === 0)
    return 'No Soundor instance is connected to this session.';
  return targets
    .map(
      (target) =>
        `${target.id}  ${JSON.stringify(target.name)}  ${target.runtime}  generation ${target.generation}  ${target.capabilities.join(',')}`,
    )
    .join('\n');
}

export function formatTree(tree: DebugTree): string {
  const nodes = new Map(tree.nodes.map((node) => [node.ref.id, node]));
  const lines: string[] = [];
  const visit = (id: string, depth: number) => {
    const node = nodes.get(id);
    if (!node) return;
    lines.push('  '.repeat(depth) + nodeLabel(node));
    for (const child of node.children) visit(child, depth + 1);
  };
  for (const root of tree.roots) visit(root, 0);
  lines.push(
    `generation ${tree.generation}, ${tree.nodes.length} nodes${tree.truncated ? ' (truncated: the snapshot holds at most 5000)' : ''}`,
  );
  return lines.join('\n');
}

export function formatNode(node: DebugNode): string {
  const { x, y, width, height } = node.bounds;
  const lines = [
    nodeLabel(node),
    `  ref: generation ${node.ref.generation}, id ${node.ref.id}`,
    `  bounds: x ${x}, y ${y}, ${width} × ${height}`,
    `  visible: ${node.visible}, focused: ${node.focused}`,
  ];
  if (node.text !== undefined)
    lines.push(`  text: ${JSON.stringify(node.text)}`);
  for (const group of [
    'accessibility',
    'properties',
    'layout',
    'presentation',
    'styles',
  ] as const) {
    const value = node[group];
    if (value) lines.push(`  ${group}: ${JSON.stringify(value)}`);
  }
  return lines.join('\n');
}
