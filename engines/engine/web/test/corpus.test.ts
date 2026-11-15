// Native/WebAssembly parity: the engine's layout corpus (tests/layout), whose
// frames the native runtime computes and checks (its "layout corpus" suite),
// laid out by the WebAssembly module from the same trees. Both are the same
// C++ (SoundorCoreSources.cmake) and Yoga, with the same text approximation;
// the frames must be equal, bit for bit.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { Engine, type EngineNode, type Style } from '../src/index.ts';
import { wasmModule } from './wasm.ts';

interface Tree {
  type: 'view' | 'text';
  text?: string;
  style: Style;
  children: Tree[];
}

interface Corpus {
  view: [number, number];
  scales: number[];
  entries: { tree: Tree; frames: Record<string, number[][]> }[];
}

const corpus = JSON.parse(
  readFileSync(
    new URL('../../tests/layout/corpus.json', import.meta.url),
    'utf8',
  ),
) as Corpus;

describe('the layout corpus', () => {
  it.each(corpus.scales)('has the native frames at scale %d', async (scale) => {
    const engine = await Engine.create({
      wasm: await wasmModule(),
      textMeasurement: 'approximate',
    });
    engine.setSize(...corpus.view);
    engine.setScale(scale);
    const make = (tree: Tree): EngineNode => {
      const node =
        tree.type === 'text'
          ? engine.createText(tree.text, tree.style)
          : engine.createView(tree.style);
      for (const child of tree.children) node.appendChild(make(child));
      return node;
    };
    const frames = (node: EngineNode, out: number[][] = []): number[][] => {
      const { x, y, width, height } = node.layout;
      out.push([x, y, width, height]);
      for (const child of node.children) frames(child, out);
      return out;
    };
    const differing: string[] = [];
    corpus.entries.forEach((entry, index) => {
      const node = make(entry.tree);
      engine.root.appendChild(node);
      const got = frames(node);
      const want = entry.frames[String(scale)];
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        const at = got.findIndex(
          (frame, i) => JSON.stringify(frame) !== JSON.stringify(want?.[i]),
        );
        differing.push(
          `tree ${index}, node ${at}: ${JSON.stringify(got[at])}, not ${JSON.stringify(want?.[at])}`,
        );
      }
      engine.root.removeChild(node);
    });
    expect(differing).toEqual([]);
    engine.dispose();
  });
});
