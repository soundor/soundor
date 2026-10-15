import type { DebugNode } from '@soundor/devtools-protocol';
export function node(
  id: string,
  parent: string | null,
  children: string[],
  extra: Partial<DebugNode> = {},
): DebugNode {
  return {
    ref: { generation: 1, id },
    type: 'View',
    parent,
    children,
    bounds: { x: 12, y: 24, width: 96, height: 96 },
    focused: false,
    visible: true,
    ...extra,
  };
}
export const originalNodes = [
  node('1', null, ['2']),
  node('2', '1', ['3']),
  node('3', '2', [], {
    type: 'Text',
    text: 'Gain',
    debugId: 'gain',
    styles: { opacity: 1 },
    presentation: { opacity: 0.5 },
    accessibility: { role: 'adjustable', name: 'Gain', value: 0.5 },
    layout: { scale: 1 },
  }),
];
