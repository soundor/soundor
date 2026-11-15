// The DOM adapter in Chromium: the fixture's page (fixture/, `?bare`) served
// by Vite with the locally built module, driven by Playwright. The engine
// lays out; the elements must be where it says, the text measured by the
// browser and wrapped by the engine.
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Engine } from '../src/index.ts';
import { wasmBytes } from './wasm.ts';

declare global {
  interface Window {
    soundor: { Engine: typeof Engine; wasmUrl: string };
    /** A container of that size, added to the page. */
    stage: (width: number, height: number) => HTMLElement;
  }
}

let server: ViteDevServer;
let browser: Browser;
let page: Page;
let origin: string;

beforeAll(async () => {
  wasmBytes(); // built, or why not
  server = await createServer({
    configFile: fileURLToPath(
      new URL('../fixture/vite.config.ts', import.meta.url),
    ),
    server: { port: 0 },
  });
  await server.listen();
  origin = server.resolvedUrls!.local[0]!.replace(/\/$/, '');
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

beforeEach(async () => {
  await page?.close();
  page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.stage = (width, height) => {
      const element = document.createElement('div');
      element.style.cssText = `width:${width}px;height:${height}px;position:relative`;
      document.body.append(element);
      return element;
    };
  });
  await page.goto(`${origin}/?bare`);
  await page.waitForFunction(() => window.soundor !== undefined);
  if (errors.length) throw new Error(`the page failed: ${errors.join('; ')}`);
});

describe('the DOM adapter', () => {
  it('shows the tree as nested elements where the engine laid them out', async () => {
    const result = await page.evaluate(async () => {
      const stage = window.stage(400, 300);
      const { Engine, wasmUrl } = window.soundor;
      const engine = await Engine.create({ wasmUrl });
      engine.root.style = { flexDirection: 'row', padding: 10, gap: 10 };
      const a = engine.root.appendChild(
        engine.createView({
          width: 100,
          borderWidth: 5,
          padding: 5,
          backgroundColor: 'red',
        }),
      );
      const inner = a.appendChild(
        engine.createView({ height: 20, backgroundColor: 'blue' }),
      );
      const b = engine.root.appendChild(
        engine.createView({ flex: 1, backgroundColor: 'green' }),
      );
      const label = b.appendChild(engine.createText('Hello', { fontSize: 16 }));
      engine.mount(stage);
      const box = (element: Element | null) => {
        const rect = element!.getBoundingClientRect();
        const origin = stage.getBoundingClientRect();
        return [
          rect.left - origin.left,
          rect.top - origin.top,
          rect.width,
          rect.height,
        ];
      };
      return {
        tags: [engine.element!, a.element!, inner.element!, label.element!].map(
          (element) => element.tagName,
        ),
        nested:
          inner.element!.parentElement === a.element &&
          a.element!.parentElement === engine.element,
        inStage: engine.element!.parentElement === stage,
        boxes: [
          box(engine.element),
          box(a.element),
          box(inner.element),
          box(b.element),
        ],
        background: getComputedStyle(a.element!).backgroundColor,
        border: getComputedStyle(a.element!).borderLeftWidth,
      };
    });
    expect(result.tags).toEqual(['DIV', 'DIV', 'DIV', 'SPAN']);
    expect(result.nested).toBe(true);
    expect(result.inStage).toBe(true);
    expect(result.boxes).toEqual([
      [0, 0, 400, 300],
      [10, 10, 100, 280],
      // Inside a's border and padding.
      [20, 20, 80, 20],
      [120, 10, 270, 280],
    ]);
    expect(result.background).toBe('rgb(255, 0, 0)');
    expect(result.border).toBe('5px');
  });

  it('updates existing elements in place', async () => {
    const result = await page.evaluate(async () => {
      const stage = window.stage(300, 200);
      const { Engine, wasmUrl } = window.soundor;
      const engine = await Engine.create({ wasmUrl });
      const box = engine.root.appendChild(
        engine.createView({ height: 50, backgroundColor: 'red' }),
      );
      engine.mount(stage);
      const element = box.element;
      const children = stage.querySelectorAll('*').length;
      box.style = { height: 80, width: '50%', backgroundColor: 'blue' };
      // Mounted, the engine lays out by itself after the task's changes.
      await Promise.resolve();
      return {
        same: box.element === element,
        children: stage.querySelectorAll('*').length === children,
        size: [element!.offsetWidth, element!.offsetHeight],
        background: getComputedStyle(element!).backgroundColor,
      };
    });
    expect(result).toEqual({
      same: true,
      children: true,
      size: [150, 80],
      background: 'rgb(0, 0, 255)',
    });
  });

  it('measures text with the browser and wraps it in the engine', async () => {
    const result = await page.evaluate(async () => {
      const stage = window.stage(600, 400);
      const { Engine, wasmUrl } = window.soundor;
      const engine = await Engine.create({ wasmUrl });
      const style = { fontSize: 20, fontFamily: 'serif', lineHeight: 30 };
      engine.root.style = { alignItems: 'flex-start' };
      const short = engine.root.appendChild(
        engine.createText('Intrinsic width', style),
      );
      const column = engine.root.appendChild(engine.createView({ width: 150 }));
      const long = column.appendChild(
        engine.createText(
          'A sentence long enough to wrap onto several lines',
          style,
        ),
      );
      engine.mount(stage);
      // What the browser draws: a span of the text alone, unconstrained.
      const span = document.createElement('span');
      span.style.cssText =
        'font: 400 20px serif; font-kerning: normal; white-space: pre; position: absolute';
      span.textContent = 'Intrinsic width';
      document.body.append(span);
      const natural = span.getBoundingClientRect().width;
      const lines = [...long.element!.children].map((line) => {
        const rect = line.getBoundingClientRect();
        return {
          text: line.textContent,
          width: rect.width,
          height: rect.height,
        };
      });
      return {
        natural,
        engineWidth: short.layout.width,
        lineWidths: long.lines.map((line) => line.width),
        lines,
        height: long.layout.height,
        columnWidth: column.layout.width,
      };
    });
    // The engine's width is the browser's, snapped to the pixel grid.
    expect(Math.abs(result.engineWidth - result.natural)).toBeLessThanOrEqual(
      1,
    );
    expect(result.lines.length).toBeGreaterThan(2);
    expect(result.height).toBe(result.lines.length * 30);
    for (const [index, line] of result.lines.entries()) {
      // Each line fits, as the engine measured it, and is one line.
      expect(line.width).toBeLessThanOrEqual(result.columnWidth);
      expect(Math.abs(line.width - result.lineWidths[index]!)).toBeLessThan(
        0.05,
      );
      expect(line.height).toBe(30);
    }
    expect(result.lines.map((line) => line.text).join(' ')).toBe(
      'A sentence long enough to wrap onto several lines',
    );
  });

  it('lays out again when the container resizes, rewrapping text', async () => {
    const result = await page.evaluate(async () => {
      const stage = window.stage(500, 300);
      const { Engine, wasmUrl } = window.soundor;
      const engine = await Engine.create({ wasmUrl });
      engine.root.style = { padding: 10 };
      const text = engine.root.appendChild(
        engine.createText('The quick brown fox jumps over the lazy dog', {
          fontSize: 18,
        }),
      );
      engine.mount(stage);
      const before = {
        width: engine.root.layout.width,
        lines: text.lines.length,
      };
      stage.style.width = '120px';
      stage.style.height = '400px';
      // ResizeObserver delivers before the next paint.
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const after = {
        width: engine.element!.offsetWidth,
        height: engine.element!.offsetHeight,
        lines: text.element!.children.length,
        textWidth: text.element!.offsetWidth,
      };
      return { before, after, size: engine.size };
    });
    expect(result.before).toEqual({ width: 500, lines: 1 });
    expect(result.after.width).toBe(120);
    expect(result.after.height).toBe(400);
    expect(result.after.textWidth).toBe(100);
    expect(result.after.lines).toBeGreaterThan(2);
    expect(result.size).toEqual({ width: 120, height: 400 });
  });

  it('runs engines side by side, independent', async () => {
    const result = await page.evaluate(async () => {
      const { Engine, wasmUrl } = window.soundor;
      const [a, b] = await Promise.all([
        Engine.create({ wasmUrl }),
        Engine.create({ wasmUrl }),
      ]);
      a.root.appendChild(a.createView({ flex: 1, backgroundColor: 'red' }));
      b.root.style = { flexDirection: 'row' };
      b.root.appendChild(b.createView({ width: 10 }));
      b.root.appendChild(b.createView({ width: 20 }));
      a.mount(window.stage(100, 100));
      b.mount(window.stage(200, 50));
      const out = {
        a: [a.nodeCount, a.root.children[0]!.layout],
        b: [b.nodeCount, b.root.children[1]!.layout],
      };
      a.dispose();
      out.b.push(b.root.children[1]!.layout.x);
      return out;
    });
    expect(result.a).toEqual([2, { x: 0, y: 0, width: 100, height: 100 }]);
    expect(result.b).toEqual([3, { x: 10, y: 0, width: 20, height: 50 }, 10]);
  });

  it('cleans up after itself, however many times it starts', async () => {
    const result = await page.evaluate(async () => {
      const stage = window.stage(200, 200);
      const { Engine, wasmUrl } = window.soundor;
      for (let i = 0; i < 25; i++) {
        const engine = await Engine.create({ wasmUrl });
        engine.root.appendChild(engine.createText(`run ${i}`));
        engine.mount(stage);
        engine.dispose();
        if (stage.childElementCount !== 0)
          return `elements left after run ${i}`;
      }
      // Its observer is gone: resizing calls into no disposed engine.
      stage.style.width = '300px';
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      return 'clean';
    });
    expect(result).toBe('clean');
  });

  it('reports what goes wrong', async () => {
    const result = await page.evaluate(async () => {
      const { Engine, wasmUrl } = window.soundor;
      const missing = await Engine.create({ wasmUrl: '/missing.wasm' }).then(
        () => 'loaded',
        (error: Error) => error.message,
      );
      const engine = await Engine.create({ wasmUrl });
      const box = engine.root.appendChild(
        engine.createView({ height: 10, backgroundColor: 'red' }),
      );
      engine.mount(window.stage(100, 100));
      box.style = { height: 10, backgroundColor: 'nope' };
      let thrown = '';
      try {
        engine.flush();
      } catch (error) {
        thrown = `${(error as Error).name}: ${(error as Error).message}`;
      }
      return {
        missing,
        thrown,
        background: getComputedStyle(box.element!).backgroundColor,
        mountedTwice: (() => {
          try {
            engine.mount(document.body);
            return 'mounted';
          } catch (error) {
            return (error as Error).message;
          }
        })(),
      };
    });
    expect(result.missing).toMatch(/missing\.wasm/);
    expect(result.thrown).toBe(
      "TypeError: style.backgroundColor: expected a CSS color, got 'nope'",
    );
    // The last good style is still drawn.
    expect(result.background).toBe('rgb(255, 0, 0)');
    expect(result.mountedTwice).toBe('the engine is mounted already');
  });
});
