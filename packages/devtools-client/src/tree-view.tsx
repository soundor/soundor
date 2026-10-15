import type { DebugNode } from '@soundor/devtools-protocol';
import { useLayoutEffect, useRef } from 'react';

import type { Inspector } from './controller';
import { label, filterTree } from './tree';

export function TreeView({
  inspector: { state, ui, actions },
}: {
  inspector: Inspector;
}) {
  const container = useRef<HTMLDivElement>(null);
  const query = ui.search.trim().toLowerCase();
  const matches = filterTree(state.nodes, query);
  const rows: Array<{ node: DebugNode; depth: number; open: boolean }> = [];
  const seen = new Set<string>();
  const stack =
    state.tree?.roots.toReversed().map((id) => ({ id, depth: 0 })) ?? [];
  while (stack.length && seen.size < 5000) {
    const entry = stack.pop()!;
    if (seen.has(entry.id) || (matches && !matches.has(entry.id))) continue;
    const node = state.nodes.get(entry.id);
    if (!node) continue;
    seen.add(entry.id);
    const open = !!query || state.expanded.has(entry.id);
    rows.push({ node, depth: entry.depth, open });
    if (open)
      for (const id of node.children.toReversed())
        stack.push({ id, depth: entry.depth + 1 });
  }
  useLayoutEffect(() => {
    if (!ui.reveal) return;
    const row = [
      ...(container.current?.querySelectorAll<HTMLElement>('.tree-row') ?? []),
    ].find((item) => item.dataset.nodeId === state.selected?.id);
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [ui.reveal, state.selected?.id]);
  return (
    <div
      id="tree"
      role="tree"
      aria-label="Native UI hierarchy"
      ref={container}
      onMouseLeave={() => actions.queueHighlight(state.selected ?? null)}
    >
      {ui.treeMessage || !rows.length ? (
        <div className="empty">
          {ui.treeMessage ||
            (query ? 'No matching nodes.' : 'The UI tree is empty.')}
        </div>
      ) : (
        rows.map(({ node, depth, open }, index) => (
          <div
            key={`${node.ref.generation}/${node.ref.id}`}
            className="tree-row"
            data-node-id={node.ref.id}
            style={{ paddingLeft: Math.min(depth, 80) * 16 + 8 }}
            role="treeitem"
            aria-level={depth + 1}
            aria-selected={state.selected?.id === node.ref.id}
            aria-expanded={node.children.length ? open : undefined}
            tabIndex={
              state.selected?.id === node.ref.id ||
              (!state.selected && index === 0)
                ? 0
                : -1
            }
            onClick={() => actions.selectNode(node.ref)}
            onMouseEnter={() => actions.queueHighlight(node.ref)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                actions.selectNode(node.ref);
              }
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft')
                actions.expand(node.ref.id, event.key === 'ArrowRight');
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const nextIndex = index + (event.key === 'ArrowDown' ? 1 : -1);
                const next = rows[nextIndex];
                if (next) {
                  container.current
                    ?.querySelectorAll<HTMLElement>('.tree-row')
                    [nextIndex]?.focus();
                  actions.selectNode(next.node.ref);
                }
              }
            }}
          >
            <button
              tabIndex={-1}
              aria-label={`${open ? 'Collapse' : 'Expand'} ${node.type}`}
              disabled={!node.children.length}
              onClick={(event) => {
                event.stopPropagation();
                actions.expand(node.ref.id, !open);
              }}
            >
              {node.children.length ? (open ? '▾' : '▸') : '·'}
            </button>
            <span className="node-label">{label(node)}</span>
            <span className="node-id">{node.ref.id}</span>
          </div>
        ))
      )}
    </div>
  );
}
