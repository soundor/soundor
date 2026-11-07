import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { EXPORTS } from './exports.ts';
import {
  Edge,
  FlexDirection,
  loadYoga,
  MeasureMode,
  NodeType,
  type Yoga,
  type YogaConfig,
  type YogaNode,
} from './index.ts';

const yoga: Yoga = loadYoga();

/** A tree of `count` children in a parent, laid out, then freed. */
function layout(
  build: (config: YogaConfig, root: YogaNode) => void,
  scale = 1,
  width = 800,
  height = 600,
): void {
  const config = yoga.YGConfigNew();
  yoga.YGConfigSetPointScaleFactor(config, scale);
  const root = yoga.YGNodeNewWithConfig(config);
  yoga.YGNodeStyleSetWidth(root, width);
  yoga.YGNodeStyleSetHeight(root, height);
  build(config, root);
  yoga.YGNodeRemoveAllChildren(root);
  yoga.YGNodeFree(root);
  yoga.YGConfigFree(config);
}

const frame = (node: YogaNode): number[] => [
  yoga.YGNodeLayoutGetLeft(node),
  yoga.YGNodeLayoutGetTop(node),
  yoga.YGNodeLayoutGetWidth(node),
  yoga.YGNodeLayoutGetHeight(node),
];

describe('the module', () => {
  it('imports nothing but its measure function and what libc links', () => {
    const module = new WebAssembly.Module(
      readFileSync(new URL('../generated/yoga.wasm', import.meta.url)),
    );
    // Anything new here means something reached further into libc: look at it,
    // and at the stubs in index.ts.
    expect(
      WebAssembly.Module.imports(module)
        .map((entry) => `${entry.module}.${entry.name}`)
        .sort(),
    ).toEqual([
      'env.measure',
      'wasi_snapshot_preview1.fd_close',
      'wasi_snapshot_preview1.fd_fdstat_get',
      'wasi_snapshot_preview1.fd_seek',
      'wasi_snapshot_preview1.fd_write',
      'wasi_snapshot_preview1.random_get',
    ]);
  });

  it('exports everything in the list', () => {
    for (const name of EXPORTS)
      expect([name, typeof yoga[name]]).toEqual([name, 'function']);
  });

  it('is one instance', () => {
    expect(loadYoga()).toBe(yoga);
  });
});

describe('layout', () => {
  it('rounds to the pixel grid: three flex boxes in 100', () => {
    layout(
      (config, root) => {
        yoga.YGNodeStyleSetFlexDirection(root, FlexDirection.Row);
        const children = [0, 1, 2].map((index) => {
          const child = yoga.YGNodeNewWithConfig(config);
          yoga.YGNodeStyleSetFlexGrow(child, 1);
          yoga.YGNodeInsertChild(root, child, index);
          return child;
        });
        yoga.YGNodeCalculateLayout(root, 100, 50, 1);
        expect(children.map((child) => frame(child))).toEqual([
          [0, 0, 33, 50],
          [33, 0, 34, 50],
          [67, 0, 33, 50],
        ]);
        children.forEach((child) => yoga.YGNodeFree(child));
      },
      1,
      100,
      50,
    );
  });

  it('calls the measure handler with the node it was given', () => {
    const seen: number[] = [];
    yoga.setMeasureHandler((id, _w, widthMode, _h, _hm, size) => {
      seen.push(id);
      expect(widthMode).toBe(MeasureMode.AtMost);
      size(42.5, 17);
    });
    layout((config, root) => {
      const text = yoga.YGNodeNewWithConfig(config);
      yoga.setMeasure(text, 1234);
      yoga.YGNodeStyleSetFlexDirection(root, FlexDirection.Row);
      yoga.YGNodeInsertChild(root, text, 0);
      yoga.YGNodeCalculateLayout(root, 800, 600, 1);
      expect(seen).toContain(1234);
      expect(yoga.YGNodeLayoutGetHeight(text)).toBe(600);
      expect(yoga.YGNodeLayoutGetWidth(text)).toBe(43);
      yoga.YGNodeFree(text);
    });
    yoga.setMeasureHandler(null);
  });

  // The two reasons this package exists, instead of npm's yoga-layout.
  it("has the engine's patch: a box with no room measures its content", () => {
    yoga.setMeasureHandler((_id, width, mode, height, heightMode, size) =>
      size(
        mode === MeasureMode.Exactly ? width : 40,
        heightMode === MeasureMode.Exactly ? height : 17,
      ),
    );
    layout((config, root) => {
      // A row squeezed to zero, around a box that fits a text.
      const squeezed = yoga.YGNodeNewWithConfig(config);
      yoga.YGNodeStyleSetWidth(squeezed, 0);
      yoga.YGNodeStyleSetFlexDirection(squeezed, FlexDirection.Row);
      const box = yoga.YGNodeNewWithConfig(config);
      yoga.YGNodeStyleSetPadding(box, Edge.Left, 4);
      const text = yoga.YGNodeNewWithConfig(config);
      yoga.setMeasure(text, 1);
      yoga.YGNodeInsertChild(box, text, 0);
      yoga.YGNodeInsertChild(squeezed, box, 0);
      yoga.YGNodeInsertChild(root, squeezed, 0);
      yoga.YGNodeCalculateLayout(root, 800, 600, 1);
      // Stock Yoga gives the box its padding alone, height 0, and no text.
      expect(yoga.YGNodeLayoutGetHeight(box)).toBe(17);
      for (const node of [text, box, squeezed]) {
        yoga.YGNodeRemoveAllChildren(node);
        yoga.YGNodeFree(node);
      }
    });
    yoga.setMeasureHandler(null);
  });

  it('rounds a text node up, so that it never loses a pixel', () => {
    const texts = (type: number): number[] => {
      let width = 0;
      yoga.setMeasureHandler((_id, _w, _wm, _h, _hm, size) => size(40.2, 17));
      layout((config, root) => {
        yoga.YGNodeStyleSetFlexDirection(root, FlexDirection.Row);
        const text = yoga.YGNodeNewWithConfig(config);
        yoga.setMeasure(text, 1);
        yoga.YGNodeSetNodeType(text, type);
        yoga.YGNodeInsertChild(root, text, 0);
        yoga.YGNodeCalculateLayout(root, 800, 600, 1);
        width = yoga.YGNodeLayoutGetWidth(text);
        yoga.YGNodeFree(text);
      });
      yoga.setMeasureHandler(null);
      return [width];
    };
    expect(texts(NodeType.Text)).toEqual([41]);
    expect(texts(NodeType.Default)).toEqual([40]);
  });
});
