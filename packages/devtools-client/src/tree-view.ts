import type { NodeRef } from '@soundor/devtools-protocol';

import type { InspectorState } from './state';
import { label, filterTree } from './tree';
export function createTreeView(options: {
  win: Window & typeof globalThis;
  state: InspectorState;
  treeView: HTMLElement;
  search: HTMLInputElement;
  selectNode(ref: NodeRef, highlight: boolean, reveal: boolean): Promise<void>;
  queueHighlight(ref: NodeRef | null): void;
  run(task: Promise<unknown>): void;
}) {
  const { win, state, treeView, search, selectNode, queueHighlight, run } =
    options;
  const doc = win.document;
  function emptyTree(message: string) {
    const empty = doc.createElement('div');
    empty.className = 'empty';
    empty.textContent = message;
    treeView.replaceChildren(empty);
  }
  function renderTree() {
    if (!state.tree) return;
    const retainFocus = treeView.contains(doc.activeElement);
    const query = search.value.trim().toLowerCase();
    const matches = filterTree(state.nodes, query);
    const fragment = doc.createDocumentFragment();
    const seen = new Set();
    const stack = state.tree.roots.toReversed().map((id) => ({
      id,
      depth: 0,
    }));
    while (stack.length && seen.size < 5000) {
      const entry = stack.pop();
      if (!entry || seen.has(entry.id) || (matches && !matches.has(entry.id)))
        continue;
      const node = state.nodes.get(entry.id);
      if (!node) continue;
      seen.add(entry.id);
      const row = doc.createElement('div');
      row.className = 'tree-row';
      row.dataset.nodeId = entry.id;
      row.style.paddingLeft = `${Math.min(entry.depth, 80) * 16 + 8}px`;
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-level', String(entry.depth + 1));
      row.setAttribute(
        'aria-selected',
        String(state.selected?.id === entry.id),
      );
      row.tabIndex = state.selected?.id === entry.id ? 0 : -1;
      const open = !!query || state.expanded.has(entry.id);
      const toggle = doc.createElement('button');
      toggle.tabIndex = -1;
      toggle.textContent = node.children.length ? (open ? '▾' : '▸') : '·';
      toggle.setAttribute(
        'aria-label',
        `${open ? 'Collapse' : 'Expand'} ${node.type}`,
      );
      if (node.children.length) row.setAttribute('aria-expanded', String(open));
      toggle.disabled = !node.children.length;
      toggle.onclick = (event) => {
        event.stopPropagation();
        if (open) state.expanded.delete(entry.id);
        else state.expanded.add(entry.id);
        renderTree();
      };
      const title = doc.createElement('span');
      title.className = 'node-label';
      title.textContent = label(node);
      const identity = doc.createElement('span');
      identity.className = 'node-id';
      identity.textContent = node.ref.id;
      row.append(toggle, title, identity);
      row.onclick = () => run(selectNode(node.ref, true, false));
      row.onmouseenter = () => queueHighlight(node.ref);
      row.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          run(selectNode(node.ref, true, false));
        }
        if (event.key === 'ArrowRight') {
          state.expanded.add(entry.id);
          renderTree();
        }
        if (event.key === 'ArrowLeft') {
          state.expanded.delete(entry.id);
          renderTree();
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const rows = [...treeView.querySelectorAll('.tree-row')];
          const next =
            rows[rows.indexOf(row) + (event.key === 'ArrowDown' ? 1 : -1)];
          if (next instanceof win.HTMLElement) {
            next.focus();
            const id = next.dataset.nodeId;
            const item = id && state.nodes.get(id);
            if (item) run(selectNode(item.ref, true, false));
          }
        }
      };
      fragment.append(row);
      if (open)
        for (const child of node.children.toReversed())
          stack.push({
            id: child,
            depth: entry.depth + 1,
          });
    }
    if (!fragment.childNodes.length)
      emptyTree(query ? 'No matching nodes.' : 'The UI tree is empty.');
    else {
      treeView.replaceChildren(fragment);
      if (retainFocus && state.selected) {
        const row = [...treeView.querySelectorAll('.tree-row')].find(
          (item) => (item as HTMLElement).dataset.nodeId === state.selected?.id,
        );
        (row as HTMLElement | undefined)?.focus();
      }
      if (!state.selected)
        (
          treeView.querySelector('.tree-row') as HTMLElement | null
        )?.setAttribute('tabindex', '0');
    }
  }
  return { render: renderTree, empty: emptyTree };
}
