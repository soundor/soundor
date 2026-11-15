// @vitest-environment happy-dom
// @soundor/engine/web's Engine in Node, on the locally built module: loading
// it, starting and disposing engines, and the C++ core's node tree, styles
// and Yoga layout through soundor:ui's nodes.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { Engine } from '../src/index.ts';
import { wasmBytes, wasmModule } from './wasm.ts';

const engines: Engine[] = [];

/** An engine laid out at 300×200 (happy-dom measures no element). */
async function engine(): Promise<Engine> {
  const created = await Engine.create({ module: await wasmModule() });
  engines.push(created);
  created.core.setSize(300, 200);
  return created;
}

afterEach(() => {
  for (const created of engines.splice(0)) created.dispose();
});

describe('initialization', () => {
  it('starts from the module or its bytes, measuring text by approximation without a canvas', async () => {
    const fromBytes = await Engine.create({ wasm: wasmBytes() });
    engines.push(fromBytes);
    fromBytes.root.style = { alignItems: 'flex-start' };
    const text = fromBytes.createText('abcd', { fontSize: 10 });
    fromBytes.root.appendChild(text);
    fromBytes.core.setSize(100, 100);
    // 0.55 em a character, lines 1.2 em.
    expect(text.layout.height).toBeCloseTo(12);
    expect(text.layout.width).toBe(22);
  });

  it('fetches a module by URL', async () => {
    const bytes = wasmBytes();
    const server = createServer((request, response) => {
      if (request.url === '/soundor-core.wasm') {
        response.writeHead(200, {
          // Not application/wasm: happy-dom's Response is not one
          // WebAssembly.compileStreaming() takes (the browser suites
          // stream it). Its page is on another origin.
          'content-type': 'application/octet-stream',
          'access-control-allow-origin': '*',
        });
        response.end(bytes);
      } else {
        response.writeHead(404, { 'access-control-allow-origin': '*' });
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
      // The roots: the content and the overlay.
      expect(fetched.core.nodeCount).toBe(2);
      await expect(
        Engine.create({ wasmUrl: `http://127.0.0.1:${port}/missing.wasm` }),
      ).rejects.toThrow(
        // happy-dom fails the request itself rather than answering 404.
        /Could not load the Soundor engine from .*missing\.wasm/,
      );
    } finally {
      server.close();
    }
  });

  it('reports what it cannot start from', async () => {
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
    expect(() => new Engine({ module: other })).toThrow(
      'The module is not the Soundor engine',
    );
  });

  it('keeps engines independent: each its own instance and tree', async () => {
    const [a, b] = [await engine(), await engine()];
    const view = a.createView({ height: 10 });
    a.root.appendChild(view);
    b.core.setSize(50, 50);
    expect(a.core.nodeCount).toBe(3);
    expect(b.core.nodeCount).toBe(2);
    expect(view.layout.width).toBe(300);
    expect(b.root.layout.width).toBe(50);
    a.dispose();
    expect(b.root.layout.width).toBe(50);
  });

  it('starts and disposes again and again', async () => {
    for (let i = 0; i < 50; i++) {
      const created = new Engine({ module: await wasmModule() });
      created.root.appendChild(created.createView({ flex: 1 }));
      created.core.setSize(10, 10);
      expect(created.root.children[0]?.layout.height).toBe(10);
      created.dispose();
      expect(created.core.disposed).toBe(true);
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

  it('batches changes: one call into the module per layout', async () => {
    const e = await engine();
    void e.root.layout;
    const before = e.core.calls;
    for (let i = 0; i < 100; i++) {
      const row = e.root.appendChild(e.createView());
      row.appendChild(e.createText(`row ${i}`));
    }
    expect(e.core.calls).toBe(before);
    expect(e.root.children[99]?.layout.y).toBeGreaterThan(0);
    expect(e.core.calls).toBe(before + 1);
    // Reading layout again changes nothing, and calls nothing.
    expect(e.root.children[50]?.layout.y).toBeGreaterThan(0);
    expect(e.core.calls).toBe(before + 1);
  });

  it('updates layout when a style changes', async () => {
    const e = await engine();
    const box = e.root.appendChild(e.createView({ width: 50, height: 50 }));
    expect(box.layout).toEqual({ x: 0, y: 0, width: 50, height: 50 });
    box.style = { width: '50%', height: 20, marginLeft: 'auto' };
    expect(box.layout).toEqual({ x: 150, y: 0, width: 150, height: 20 });
  });

  it('refuses an invalid style when it is set, keeping the last good one', async () => {
    const e = await engine();
    const box = e.root.appendChild(e.createView({ height: 20 }));
    expect(() => {
      box.style = { height: 'tall' } as never;
    }).toThrow(
      new TypeError(
        "style.height: expected a number, a percentage or 'auto', got 'tall'",
      ),
    );
    expect(box.style).toEqual({ height: 20 });
    expect(box.layout.height).toBe(20);
    expect(() => {
      box.style = { transform: [{ skew: 1 }] } as never;
    }).toThrow(new TypeError('style.transform: unsupported property skew'));
    box.style = { height: 30, transform: [{ rotate: '90deg' }] };
    expect(box.layout.height).toBe(30);
  });

  it('lays out again when the size changes', async () => {
    const e = await engine();
    const half = e.root.appendChild(e.createView({ width: '50%', flex: 1 }));
    expect(half.layout).toEqual({ x: 0, y: 0, width: 150, height: 200 });
    e.core.setSize(120, 80);
    e.layoutChanged();
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
    expect(text.layout.height).toBe(30);
    // The engine's lines are what the element shows.
    expect(e.rootElement.querySelector('.sd-text-lines')?.textContent).toBe(
      'one two\nthree four',
    );
    text.text = 'one';
    // 16.5, snapped to the pixel grid.
    expect(text.layout.width).toBe(17);
  });

  it('sizes images, canvases and SVGs by their natural size', async () => {
    const e = await engine();
    e.root.style = { alignItems: 'flex-start' };
    const canvas = e.root.appendChild(e.createCanvas());
    expect(canvas.layout).toEqual({ x: 0, y: 0, width: 300, height: 150 });
    canvas.width = 40;
    canvas.height = 20;
    expect(canvas.layout).toEqual({ x: 0, y: 0, width: 40, height: 20 });
    // One side given, the other by its aspect ratio.
    canvas.style = { width: 80 };
    expect(canvas.layout.height).toBe(40);
    const svg = e.root.appendChild(e.createSvg());
    expect(svg.layout).toMatchObject({ width: 300, height: 150 });
    // A viewBox gives its ratio, at most 300 by 150.
    svg.setSvgScene({ version: 1, viewBox: [0, 0, 100, 100], children: [] });
    expect(svg.layout).toMatchObject({ width: 150, height: 150 });
    const image = e.root.appendChild(e.createImage());
    expect(image.layout).toMatchObject({ width: 0, height: 0 });
  });

  it('measures an input by its text or placeholder, on one line', async () => {
    const e = await engine();
    e.root.style = { alignItems: 'flex-start' };
    const input = e.root.appendChild(
      e.createTextInput({ placeholder: 'abcd', style: { fontSize: 10 } }),
    );
    // Four characters and the caret.
    expect(input.layout).toMatchObject({ width: 23, height: 12 });
    input.value = 'abcdefgh';
    expect(input.layout.width).toBe(45);
  });

  it('releases the engine and its resources', async () => {
    const e = await engine();
    e.root.appendChild(e.createView());
    expect(e.core.nodeCount).toBe(3);
    e.dispose();
    expect(e.core.disposed).toBe(true);
    expect(() => e.createView()).toThrow('disposed');
    e.dispose();
  });
});
