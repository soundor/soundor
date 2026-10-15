import type {
  DebugMetrics,
  DebugTarget,
  DebugTree,
} from '@soundor/devtools-protocol';
import { expect, it } from 'vitest';

import { InspectorState } from '../src/state';

const target: DebugTarget = {
  id: 'gain',
  name: 'Gain',
  runtime: 'Simulated',
  generation: 1,
  controller: null,
  capabilities: ['inspector', 'accessibility', 'animations', 'performance'],
};
function setup() {
  const state = new InspectorState();
  state.targets = [structuredClone(target)];
  state.targetId = target.id;
  state.clientId = 'browser';
  return state;
}
function snapshot(generation = 1): DebugTree {
  return {
    generation,
    revision: 1,
    roots: ['1'],
    truncated: false,
    nodes: [
      {
        ref: { generation, id: '1' },
        type: 'View',
        parent: null,
        children: [],
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        visible: true,
        focused: false,
      },
    ],
  };
}
const metrics: DebugMetrics = {
  generation: 1,
  recording: false,
  frameCount: 1,
  elapsedMs: 10,
  phases: {},
  frames: [],
};
it('guards selection replies across reselection, target changes, reloads and selection clearing', () => {
  const state = setup();
  const first = state.beginSelection({ generation: 1, id: '1' })!;
  expect(first.changed).toBe(true);
  expect(state.isCurrentSelection(first)).toBe(true);
  const second = state.beginSelection({ generation: 1, id: '1' })!;
  expect(second.changed).toBe(false);
  expect(state.isCurrentSelection(first)).toBe(false);
  state.clearSelection();
  expect(state.isCurrentSelection(second)).toBe(false);
  const third = state.beginSelection({ generation: 1, id: '2' })!;
  state.clearInspection();
  state.targetId = 'other';
  expect(state.isCurrentSelection(third)).toBe(false);
  expect(state.beginSelection({ generation: 1, id: '1' })).toBeUndefined();
  state.targetId = 'gain';
  state.currentTarget()!.generation = 2;
  expect(state.beginSelection({ generation: 1, id: '1' })).toBeUndefined();
  expect(state.beginSelection({ generation: 2, id: '1' })).toBeDefined();
});
it('accepts current snapshots, expands roots, invalidates removed nodes and ignores stale snapshots', () => {
  const state = setup();
  expect(state.acceptTree(snapshot(), state.viewEpoch)).toBe('updated');
  expect(state.expanded.has('1')).toBe(true);
  const selected = state.beginSelection({ generation: 1, id: 'removed' })!;
  expect(state.acceptTree(snapshot(), state.viewEpoch)).toBe(
    'selection-removed',
  );
  expect(state.selected).toBeUndefined();
  expect(state.isCurrentSelection(selected)).toBe(false);
  const before = state.nodes;
  expect(state.acceptTree(snapshot(2), state.viewEpoch)).toBe('ignored');
  expect(state.acceptTree(snapshot(), state.viewEpoch - 1)).toBe('ignored');
  expect(state.nodes).toBe(before);
});
it('applies sparse patches and diagnostics only for the active target and generation', () => {
  const state = setup();
  const tree = snapshot();
  state.acceptTree(tree, state.viewEpoch);
  const patched = { ...tree.nodes[0]!, text: 'Updated' };
  const change = {
    type: 'event',
    event: 'UI.treeChanged',
    targetId: 'gain',
    data: {
      generation: 1,
      revision: 2,
      kind: 'properties',
      nodes: [patched],
      metadataIncomplete: true,
    },
  } as const;
  expect(state.applyEvent({ ...change, targetId: 'foreign' })).toEqual({
    type: 'ignored',
  });
  expect(state.nodes.get('1')?.text).toBeUndefined();
  expect(state.applyEvent(change)).toEqual({
    type: 'tree',
    structure: false,
    patched: true,
    metadataIncomplete: true,
  });
  expect(state.nodes.get('1')?.text).toBe('Updated');
  expect(
    state.applyEvent({ ...change, data: { ...change.data, generation: 2 } }),
  ).toEqual({ type: 'ignored' });
  expect(state.acceptMetrics({ ...metrics, generation: 2 })).toBe(false);
  expect(
    state.applyEvent({
      type: 'event',
      event: 'Diagnostics.metrics',
      targetId: 'gain',
      data: metrics,
    }),
  ).toEqual({ type: 'metrics' });
  expect(state.performance).toEqual(metrics);
});
it('allows picker selections only for the controlling browser and current generation', () => {
  const state = setup();
  const picked = {
    type: 'event',
    event: 'UI.nodeSelected',
    targetId: 'gain',
    data: { node: { generation: 1, id: '1' } },
  } as const;
  expect(state.applyEvent(picked)).toEqual({ type: 'ignored' });
  state.currentTarget()!.controller = 'browser';
  state.picker = true;
  expect(state.applyEvent(picked)).toEqual({
    type: 'selection',
    node: picked.data.node,
  });
  expect(state.picker).toBe(false);
  expect(
    state.applyEvent({ ...picked, data: { node: { generation: 2, id: '1' } } }),
  ).toEqual({ type: 'ignored' });
});
it('bounds logs and animation history, retains session logs, and clears target inspection state', () => {
  const state = setup();
  for (let i = 0; i < 1005; ++i)
    state.applyEvent({
      type: 'event',
      event: 'Console.message',
      scope: 'session',
      data: { level: 'info', message: String(i), source: 'test', timestamp: i },
    });
  expect(state.logs).toHaveLength(1000);
  expect(state.logs[0]?.message).toBe('5');
  for (let i = 0; i < 105; ++i)
    state.applyEvent({
      type: 'event',
      event: 'Animation.changed',
      targetId: 'gain',
      data: {
        generation: 1,
        changes: [
          {
            id: String(i),
            playbackGeneration: 0,
            state: 'running',
            node: { generation: 1, id: '1' },
          },
        ],
        truncated: false,
      },
    });
  expect(state.animationHistory).toHaveLength(100);
  state.performance = metrics;
  state.clearInspection();
  expect(state.performance).toBeUndefined();
  expect(state.animationHistory).toEqual([]);
  expect(state.logs).toHaveLength(1000);
  expect(
    state.applyEvent({
      type: 'event',
      event: 'Runtime.generationChanged',
      targetId: 'gain',
      data: { generation: 2 },
    }),
  ).toEqual({ type: 'generation', generation: 2 });
  expect(
    state.applyEvent({
      type: 'event',
      event: 'Runtime.targetsChanged',
      data: [],
    }),
  ).toEqual({ type: 'targets', targets: [] });
});
