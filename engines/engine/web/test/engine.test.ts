// @soundor/engine/web's Engine in Node, on the locally built module: the C++
// core's node tree and Yoga layout through the JavaScript API.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { Engine } from '../src/index.ts';
import { wasmBytes, wasmModule } from './wasm.ts';

const engines: Engine[] = [];

async function engine(): Promise<Engine> {
  const created = await Engine.create({ wasm: await wasmModule() });
  engines.push(created);
  created.setSize(300, 200);
  return created;
}

afterEach(() => {
  for (const created of engines.splice(0)) created.dispose();
});

describe('initialization', () => {
  it('starts from the module or its bytes, measuring text by approximation without a canvas', async () => {
    const fromBytes = await Engine.create({ wasm: wasmBytes() });
    engines.push(fromBytes);
    const text = fromBytes.createText('abcd', { fontSize: 10 });
    fromBytes.root.appendChild(text);
    fromBytes.setSize(100, 100);
    // 0.55 em a character.
    expect(text.layout.height).toBeCloseTo(12);
    expect(text.lines[0]?.width).toBeCloseTo(4 * 5.5);
  });

  it('fetches a module by URL', async () => {
    const bytes = wasmBytes();
    const server = createServer((request, response) => {
      if (request.url === '/soundor-core.wasm') {
        response.writeHead(200, { 'content-type': 'application/wasm' });
        response.end(bytes);
      } else {
        response.writeHead(404);
        response.end();
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    try {
      const fetched = await Engine.create({
        wasmUrl: `http://127.0.0.1:${port}/soundor-core.wasm`,
      });
      engines.push(fetched);
      expect(fetched.nodeCount).toBe(1);
      await expect(
        Engine.create({ wasmUrl: `http://127.0.0.1:${port}/missing.wasm` }),
      ).rejects.toThrow(
        /Could not load the Soundor engine from .*missing\.wasm: HTTP 404/,
      );
    } finally {
      server.close();
    }
  });

  it('reports what it cannot start from', async () => {
    await expect(Engine.create({})).rejects.toThrow(TypeError);
    await expect(
      Engine.create({ wasm: new Uint8Array([0, 1, 2, 3]) }),
    ).rejects.toThrow('The Soundor engine module is not valid WebAssembly');
    await expect(
      Engine.create({ wasmUrl: 'http://127.0.0.1:1/soundor-core.wasm' }),
    ).rejects.toThrow(/Could not load the Soundor engine/);
    // A module that is not the engine's.
    const other = await WebAssembly.compile(
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
    );
    await expect(Engine.create({ wasm: other })).rejects.toThrow(
      'The module is not the Soundor engine',
    );
  });

  it('keeps engines independent', async () => {
    const [a, b] = [await engine(), await engine()];
    const view = a.createView({ height: 10 });
    a.root.appendChild(view);
    b.setSize(50, 50);
    expect(a.nodeCount).toBe(2);
    expect(b.nodeCount).toBe(1);
    expect(view.layout.width).toBe(300);
    expect(b.root.layout.width).toBe(50);
    expect(() => b.root.appendChild(view)).toThrow('another engine');
    a.dispose();
    expect(b.root.layout.width).toBe(50);
  });

  it('starts and disposes again and again', async () => {
    for (let i = 0; i < 50; i++) {
      const created = await Engine.create({ wasm: await wasmModule() });
      created.root.appendChild(created.createView({ flex: 1 }));
      created.setSize(10, 10);
      expect(created.root.children[0]?.layout.height).toBe(10);
      created.dispose();
    }
  });
});

describe('the tree', () => {
  it('lays out flexbox: rows, columns, padding and gaps', async () => {
    const e = await engine();
    e.root.style = { flexDirection: 'row', padding: 10, gap: 5 };
    const fixed = e.root.appendChild(e.createView({ width: 100 }));
    const grows = e.root.appendChild(
      e.createView({ flex: 1, paddingVertical: 4, gap: 2 }),
    );
    const a = grows.appendChild(e.createView({ height: 20 }));
    const b = grows.appendChild(e.createView({ height: '50%' }));
    expect(fixed.layout).toEqual({ x: 10, y: 10, width: 100, height: 180 });
    expect(grows.layout).toEqual({ x: 115, y: 10, width: 175, height: 180 });
    expect(a.layout).toEqual({ x: 0, y: 4, width: 175, height: 20 });
    expect(b.layout).toEqual({ x: 0, y: 26, width: 175, height: 86 });
  });

  it('inserts, reorders and removes children', async () => {
    const e = await engine();
    const [a, b, c] = [1, 2, 3].map(() => e.createView({ height: 10 })) as [
      ReturnType<Engine['createView']>,
      ReturnType<Engine['createView']>,
      ReturnType<Engine['createView']>,
    ];
    e.root.appendChild(a);
    e.root.appendChild(b);
    e.root.insertBefore(c, a);
    expect(e.root.children).toEqual([c, a, b]);
    expect([c, a, b].map((node) => node.layout.y)).toEqual([0, 10, 20]);
    // Moving: inserted again where it now goes.
    e.root.appendChild(c);
    expect(e.root.children).toEqual([a, b, c]);
    expect(c.layout.y).toBe(20);
    e.root.removeChild(a);
    expect(a.parent).toBeNull();
    expect([b.layout.y, c.layout.y]).toEqual([0, 10]);
    b.remove();
    expect(c.layout.y).toBe(0);
  });

  it('refuses what the tree cannot be', async () => {
    const e = await engine();
    const view = e.createView();
    const child = view.appendChild(e.createView());
    const text = e.createText('hi');
    expect(() => child.appendChild(view)).toThrow(
      'a node cannot contain itself',
    );
    expect(() => text.appendChild(e.createView())).toThrow(TypeError);
    expect(() => view.appendChild(e.root)).toThrow('the root has no parent');
    expect(() => e.root.insertBefore(text, child)).toThrow('not a child');
    expect(() => e.root.removeChild(view)).toThrow('not a child');
    expect(() => e.root.release()).toThrow('cannot be released');
    expect(() => {
      view.text = 'x';
    }).toThrow('only text nodes');
    // None of that reached the engine.
    expect(() => e.flush()).not.toThrow();
  });

  it('updates layout when a style changes', async () => {
    const e = await engine();
    const box = e.root.appendChild(e.createView({ width: 50, height: 50 }));
    expect(box.layout).toEqual({ x: 0, y: 0, width: 50, height: 50 });
    box.style = { width: '50%', height: 20, marginLeft: 'auto' };
    expect(box.layout).toEqual({ x: 150, y: 0, width: 150, height: 20 });
  });

  it('throws an invalid style when it lays out, keeping the last good one', async () => {
    const e = await engine();
    const box = e.root.appendChild(e.createView({ height: 20 }));
    const other = e.root.appendChild(e.createView());
    e.flush();
    const bad = { height: 'tall' } as unknown as { height: number };
    box.style = bad;
    other.style = { height: 30 };
    expect(() => e.flush()).toThrow(
      new TypeError(
        "style.height: expected a number, a percentage or 'auto', got 'tall'",
      ),
    );
    expect(box.style).toEqual({ height: 20 });
    expect(box.layout.height).toBe(20);
    // The rest of the batch was made.
    expect(other.layout).toEqual({ x: 0, y: 20, width: 300, height: 30 });
    box.style = { transform: [] } as object;
    expect(() => e.flush()).toThrow(/transform: not supported/);
  });

  it('lays out again when the size changes', async () => {
    const e = await engine();
    const half = e.root.appendChild(e.createView({ width: '50%', flex: 1 }));
    expect(half.layout).toEqual({ x: 0, y: 0, width: 150, height: 200 });
    e.setSize(120, 80);
    expect(e.root.layout).toEqual({ x: 0, y: 0, width: 120, height: 80 });
    expect(half.layout).toEqual({ x: 0, y: 0, width: 60, height: 80 });
  });

  it('wraps text and lays it out again at a new width', async () => {
    const e = await engine();
    const column = e.root.appendChild(
      e.createView({ width: 100, alignItems: 'flex-start' }),
    );
    const text = column.appendChild(
      e.createText('one two three four', { fontSize: 10, lineHeight: 15 }),
    );
    // 18 characters × 5.5: 99 wide, one line.
    expect(text.layout).toEqual({ x: 0, y: 0, width: 99, height: 15 });
    column.style = { width: 60, alignItems: 'flex-start' };
    expect(
      text.lines.map((line) => text.text.slice(line.start, line.end)),
    ).toEqual(['one two', 'three four']);
    expect(text.layout.height).toBe(30);
    text.text = 'one';
    expect(text.lines).toHaveLength(1);
    // 16.5, snapped to the pixel grid.
    expect(text.layout.width).toBe(17);
  });

  it('releases nodes and the engine its resources', async () => {
    const e = await engine();
    const parent = e.root.appendChild(e.createView());
    const child = parent.appendChild(e.createView());
    expect(e.nodeCount).toBe(3);
    parent.release();
    e.flush();
    expect(e.nodeCount).toBe(2);
    expect(parent.released).toBe(true);
    expect(e.root.children).toEqual([]);
    // Its child lives on, detached.
    expect(child.parent).toBeNull();
    expect(() => e.root.appendChild(parent)).toThrow('released');
    e.root.appendChild(child);
    expect(child.layout.width).toBe(300);
    child.release();
    e.flush();
    expect(e.nodeCount).toBe(1);

    e.dispose();
    expect(e.disposed).toBe(true);
    expect(() => e.createView()).toThrow('disposed');
    expect(() => e.flush()).toThrow('disposed');
    e.dispose();
  });
});
