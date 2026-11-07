// @vitest-environment happy-dom
//
// The point of laying out with Yoga: the engine's own frames for these trees
// (engines/engine/tests/layout/corpus.json, written through its soundor:ui),
// matched to the last bit by the same style properties set here. happy-dom has
// no canvas, so text measures as the engine's approximate text engine does.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { UiNode } from './node';
import type { NodeType, Style } from './types';
import { UiView } from './view';

interface Tree {
  readonly type: NodeType;
  readonly text?: string;
  readonly style: Style;
  readonly children: readonly Tree[];
}

const corpus = JSON.parse(
  // happy-dom's import.meta.url is no file: from the package's own directory.
  readFileSync(
    join(process.cwd(), '../../engines/engine/tests/layout/corpus.json'),
    'utf8',
  ),
) as {
  readonly view: readonly [number, number];
  readonly scales: readonly number[];
  readonly entries: readonly {
    readonly tree: Tree;
    readonly frames: Readonly<Record<string, readonly number[][]>>;
  }[];
};

const frames = (node: UiNode, out: number[][] = []): number[][] => {
  const { x, y, width, height } = node.layout;
  out.push([x, y, width, height]);
  for (const child of node.children) frames(child, out);
  return out;
};

/** A tree's nodes in the frames' order, without what is in them. */
const flat = (tree: Tree, out: Omit<Tree, 'children'>[] = []) => {
  const { children, ...node } = tree;
  out.push(node);
  for (const child of children) flat(child, out);
  return out;
};

describe('the layout corpus', () => {
  let view: UiView;
  afterEach(() => {
    view?.dispose();
    vi.restoreAllMocks();
  });

  function make(tree: Tree): UiNode {
    const node = view.createNode(tree.type);
    node.style = tree.style;
    if (tree.type === 'text') node.text = tree.text ?? '';
    for (const child of tree.children) node.appendChild(make(child));
    return node;
  }

  it.each(corpus.scales)('matches the engine at scale %s', (scale) => {
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(scale);
    view = new UiView(document);
    view.mount(document.body);
    const [width, height] = corpus.view;
    Object.defineProperties(view.rootElement, {
      offsetWidth: { value: width },
      offsetHeight: { value: height },
    });
    view.measure();
    expect(corpus.entries.length).toBeGreaterThan(100);
    const differing: string[] = [];
    corpus.entries.forEach((entry, index) => {
      const node = make(entry.tree);
      view.root.appendChild(node);
      const got = frames(node);
      const want = entry.frames[scale]!;
      const at = got.findIndex(
        (frame, i) => JSON.stringify(frame) !== JSON.stringify(want[i]),
      );
      if (at >= 0)
        differing.push(
          `tree ${index}, node ${at} (${JSON.stringify(flat(entry.tree)[at])}): ${JSON.stringify(got[at])}, the engine ${JSON.stringify(want[at])}`,
        );
      view.root.removeChild(node);
    });
    expect(differing).toEqual([]);
  });
});
