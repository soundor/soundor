import { describe, expect, it } from 'vitest';

import { createTestRuntime, createUiModule } from './index';
import type { SvgScene } from './types';

describe('SVG scene simulation', () => {
  it('owns a cloned, atomic scene on one UI leaf and releases it on disposal', () => {
    const runtime = createTestRuntime();
    const ui = createUiModule(runtime);
    const svg = ui.createSvg({ width: 24, height: 24 });
    ui.root.appendChild(svg);
    const data: SvgScene = {
      version: 1,
      viewBox: [0, 0, 24, 24],
      children: [
        {
          type: 'circle',
          cx: 12,
          cy: 12,
          r: 10,
          presentation: { fill: 'red' },
        },
      ],
    };
    svg.setSvgScene(data);
    expect(svg.type).toBe('svg');
    expect(svg.children).toEqual([]);
    expect(runtime.nodes.size).toBe(3); // two roots and the SVG
    expect(svg.svgScene).toEqual(data);
    expect(svg.svgScene).not.toBe(data);
    expect(svg.svgSceneUpdates).toBe(1);
    svg.setSvgScene(data);
    expect(svg.svgSceneUpdates).toBe(1);
    const before = svg.svgScene;
    expect(() =>
      svg.setSvgScene({
        version: 1,
        children: [{ type: 'path', d: 'M0 0 L' }],
      }),
    ).toThrow('path');
    expect(svg.svgScene).toBe(before);
    expect(() => svg.appendChild(ui.createView())).toThrow('only views');
    svg.setSvgScene(null);
    expect(svg.svgScene).toBe(null);
    svg.setSvgScene(data);
    runtime.dispose();
    expect(svg.svgScene).toBe(null);
    expect(() => svg.setSvgScene(data)).toThrow('disposed');
  });
});
