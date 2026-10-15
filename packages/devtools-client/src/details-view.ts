import type { DebugNode } from '@soundor/devtools-protocol';

import type { InspectorState } from './state';
import { label } from './tree';
export function createDetailsView(doc: Document, state: InspectorState) {
  const details = doc.getElementById('details')!;
  const supports = (capability: string) => state.supports(capability);
  function detailGroup(heading: string, data: Record<string, unknown>) {
    if (!Object.keys(data).length) return;
    const group = doc.createElement('details');
    group.className = 'detail-group';
    group.open = true;
    const summary = doc.createElement('summary');
    summary.textContent = heading;
    const table = doc.createElement('table');
    for (const [name, value] of Object.entries(data)) {
      const row = doc.createElement('tr');
      const key = doc.createElement('td');
      const cell = doc.createElement('td');
      key.textContent = name;
      cell.textContent =
        typeof value === 'object'
          ? JSON.stringify(value, null, 2)
          : String(value);
      row.append(key, cell);
      table.append(row);
    }
    group.append(summary, table);
    details.append(group);
  }
  function renderDetails(node?: DebugNode) {
    const heading = doc.createElement('h2');
    heading.textContent = 'Details';
    details.replaceChildren(heading);
    if (!node) {
      const empty = doc.createElement('div');
      empty.className = 'empty';
      empty.textContent = state.selected
        ? 'Loading node…'
        : 'Select a node to inspect its live engine state.';
      details.append(empty);
      return;
    }
    const title = doc.createElement('div');
    title.className = 'node-heading';
    title.textContent = label(node);
    details.append(title);
    detailGroup('Properties', {
      type: node.type,
      identity: `${state.targetId} / ${node.ref.generation} / ${node.ref.id}`,
      ...(node.debugId
        ? {
            debugId: node.debugId,
          }
        : {}),
      ...(node.text !== undefined
        ? {
            text: node.text,
          }
        : {}),
      focused: node.focused,
      visible: node.visible,
      ...node.properties,
    });
    detailGroup('Layout', {
      bounds: node.bounds,
      ...node.layout,
    });
    if (node.styles) detailGroup('Base styles', node.styles);
    if (node.presentation)
      detailGroup('Presentation values', node.presentation);
    if (supports('accessibility') && node.accessibility)
      detailGroup('Accessibility', node.accessibility);
  }
  return { render: renderDetails, group: detailGroup };
}
