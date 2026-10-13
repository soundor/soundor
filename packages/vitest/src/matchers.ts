import { getTestRuntime, type TestNode } from '@soundor/test-runtime';
function describe(node: TestNode | null): string {
  if (!node) return 'no focused node';
  return `${node.type} #${node.id}${node.accessibility.label ? ` (${JSON.stringify(node.accessibility.label)})` : ''}`;
}

export const soundorMatchers = {
  toHaveFocus(received: unknown) {
    const runtime = getTestRuntime();
    if (!received || typeof received !== 'object' || !('runtime' in received))
      throw new TypeError('toHaveFocus expects a Soundor node');
    const node = received as TestNode;
    runtime.assertNode(node);
    if (runtime.nodes.get(node.id) !== node || !node.isConnected)
      throw new TypeError(
        'toHaveFocus requires a connected Soundor node from the current test',
      );
    const focused = runtime.focusedNode();
    return {
      pass: focused === node,
      message: () =>
        `Expected ${describe(node)} ${focused === node ? 'not ' : ''}to have focus.\nActual focus: ${describe(focused)}`,
    };
  },
};
