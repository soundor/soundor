import type { DebugMetrics } from '@soundor/devtools-protocol';
import { originalNodes } from '@soundor/devtools-server/testing';
import { expect, it } from 'vitest';

import { metricSummary, mergeMetrics } from '../src/diagnostics';
import { filterTree, label } from '../src/tree';

it('filters by accessibility and retains ancestors, tolerating cycles and absent parents', () => {
  const nodes = structuredClone(originalNodes);
  nodes[0]!.parent = '3';
  const map = new Map(nodes.map((node) => [node.ref.id, node]));
  expect([...filterTree(map, 'adjustable')!]).toEqual(['3', '2', '1']);
  expect(filterTree(map, '')).toBeUndefined();
  expect(filterTree(map, 'missing')?.size).toBe(0);
  expect(label(nodes[2]!)).toContain('Gain');
});
it('merges bounded diagnostic windows and preserves unavailable measurements', () => {
  const base: DebugMetrics = {
    generation: 1,
    recording: true,
    elapsedMs: 1,
    frameCount: 1,
    phases: {},
    frames: [{ timestampMs: 1, frameMs: 3 }],
  };
  const next = { ...base, frames: [{ timestampMs: 2, layoutMs: 0 }] };
  expect(mergeMetrics(base, next).frames).toHaveLength(2);
  expect(mergeMetrics(base, next, true).frames).toHaveLength(1);
  expect(mergeMetrics(base, { ...next, frameCount: 0 }).frames).toEqual(
    next.frames,
  );
  expect(metricSummary(next)).toMatchObject({ 'Layout (ms)': '0.00' });
  expect(metricSummary(next)).not.toHaveProperty('CPU frame (ms)');
});
