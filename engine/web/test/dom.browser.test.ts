// soundor:ui's DOM adapter in Chromium: the fixture's page (fixture/,
// `?bare`) served by Vite with the locally built module, driven by
// Playwright. The engine lays out; the elements must be where it says, the
// text measured by the browser and wrapped by the engine, and the browser's
// input routed to the nodes.
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Engine, UiNode } from '../src/index.ts';
import type { PointerEvent as UiPointerEvent } from '../src/ui/events.ts';
import { wasmBytes } from './wasm.ts';

declare global {
  interface Window {
    soundor: {
      Engine: typeof Engine;
      wasmUrl: string;
      element: (node: UiNode) => HTMLElement | SVGSVGElement;
    };
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
  it('routes one context menu per gesture without changing the focused control', async () => {
    const point = await page.evaluate(async () => {
      const stage = window.stage(400, 300);
      const { Engine, wasmUrl, element } = window.soundor;
      const engine = await Engine.create({ wasmUrl });
      engine.root.style = { padding: 10 };
      const wrapper = engine.root.appendChild(engine.createView());
      const slider = wrapper.appendChild(
        engine.createView({ width: 80, height: 30 }),
      );
      slider.focusable = true;
      slider.accessibility = {
        role: 'adjustable',
        label: 'Gain',
        value: { min: 0, max: 100, now: 50 },
      };
      element(slider).id = 'gain';
      const log: unknown[] = [];
      const handle = (event: Event) => {
        const e = event as UiPointerEvent;
        log.push([
          e.target === slider,
          e.currentTarget === wrapper,
          e.pageX,
          e.pageY,
          e.button,
          e.pointerType,
        ]);
        e.preventDefault();
      };
      wrapper.addEventListener('contextmenu', handle);
      document.addEventListener('contextmenu', () => log.push('escaped'));
      engine.mount(stage);
      engine.flushLayout();
      slider.focus();
      Object.assign(window, {
        menuTest: {
          log,
          remove: () => wrapper.removeEventListener('contextmenu', handle),
        },
      });
      const { left, top } = element(slider).getBoundingClientRect();
      return { x: left + 5, y: top + 5 };
    });
    const gain = page.getByRole('slider', { name: 'Gain' });
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await page.mouse.move(point.x + 120, point.y + 120);
    await page.keyboard.press('Shift+F10');
    await page.keyboard.press('ContextMenu');
    expect(await gain.getAttribute('aria-valuenow')).toBe('50');
    expect(await gain.evaluate((el) => el === document.activeElement)).toBe(
      true,
    );
    const result = await page.evaluate(() => {
      const { log, remove } = (
        window as unknown as {
          menuTest: { log: unknown[]; remove: () => void };
        }
      ).menuTest;
      const target = document.querySelector('#gain')!;
      // A browser-supplied non-pointer request is anchored to its DOM target.
      const request = () =>
        target.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
          }),
        );
      const handled = !request();
      remove();
      const unhandled = request();
      return { log, handled, unhandled };
    });
    expect(result).toEqual({
      log: [
        [true, true, 15, 15, 2, 'mouse'],
        [true, true, 10, 40, -1, ''],
        [true, true, 10, 40, -1, ''],
        [true, true, 10, 40, -1, ''],
      ],
      handled: true,
      unhandled: true,
    });
  });

  it('shows the tree as nested elements where the engine laid them out', async () => {
    const result = await page.evaluate(async () => {
      const stage = window.stage(400, 300);
      const { Engine, wasmUrl, element } = window.soundor;
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
      b.appendChild(engine.createText('Hello', { fontSize: 16 }));
      engine.mount(stage);
      engine.flushLayout();
      const box = (node: UiNode) => {
        const rect = element(node).getBoundingClientRect();
        const origin = stage.getBoundingClientRect();
        return [
          rect.left - origin.left,
          rect.top - origin.top,
          rect.width,
          rect.height,
        ];
      };
      return {
        nested:
          element(inner).parentElement === element(a) &&
          element(a).parentElement === element(engine.root),
        boxes: [box(engine.root), box(a), box(inner), box(b)],
        layouts: [a.layout, inner.layout],
        background: getComputedStyle(element(a)).backgroundColor,
        border: getComputedStyle(element(a)).borderLeftWidth,
      };
    });
    expect(result.nested).toBe(true);
    expect(result.boxes).toEqual([
      [0, 0, 400, 300],
      [10, 10, 100, 280],
      // Inside a's border and padding.
      [20, 20, 80, 20],
      [120, 10, 270, 280],
    ]);
    expect(result.layouts).toEqual([
      { x: 10, y: 10, width: 100, height: 280 },
      { x: 10, y: 10, width: 80, height: 20 },
    ]);
    expect(result.background).toBe('rgb(255, 0, 0)');
    expect(result.border).toBe('5px');
  });

  it('measures text with the browser and wraps it in the engine', async () => {
    const result = await page.evaluate(async () => {
      const stage = window.stage(600, 400);
      const { Engine, wasmUrl, element } = window.soundor;
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
      engine.flushLayout();
      // What the browser draws: a span of the text alone, unconstrained.
      const span = document.createElement('span');
      span.style.cssText =
        'font: 400 20px serif; font-kerning: normal; white-space: pre; position: absolute';
      span.textContent = 'Intrinsic width';
      document.body.append(span);
      const natural = span.getBoundingClientRect().width;
      const lines = element(long).textContent!.split('\n');
      // Each line, drawn alone as the element draws it.
      const widths = lines.map((line) => {
        span.textContent = line;
        return span.getBoundingClientRect().width;
      });
      return {
        natural,
        engineWidth: short.layout.width,
        lines,
        widths,
        height: long.layout.height,
        elementHeight: element(long).getBoundingClientRect().height,
        columnWidth: column.layout.width,
      };
    });
    // The engine's width is the browser's, snapped to the pixel grid.
    expect(Math.abs(result.engineWidth - result.natural)).toBeLessThanOrEqual(
      1,
    );
    expect(result.lines.length).toBeGreaterThan(2);
    expect(result.height).toBe(result.lines.length * 30);
    expect(result.elementHeight).toBe(result.height);
    for (const width of result.widths)
      expect(width).toBeLessThanOrEqual(result.columnWidth);
    expect(result.lines.join(' ')).toBe(
      'A sentence long enough to wrap onto several lines',
    );
  });

  it('lays out again when the container resizes, rewrapping text', async () => {
    const result = await page.evaluate(async () => {
      const stage = window.stage(500, 300);
      const { Engine, wasmUrl, element } = window.soundor;
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
        lines: element(text).textContent!.split('\n').length,
      };
      stage.style.width = '120px';
      stage.style.height = '400px';
      // ResizeObserver delivers before the next paint.
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      engine.flushLayout();
      return {
        before,
        after: {
          width: (element(engine.root) as HTMLElement).offsetWidth,
          height: (element(engine.root) as HTMLElement).offsetHeight,
          lines: element(text).textContent!.split('\n').length,
          textWidth: text.layout.width,
        },
        size: engine.size(),
      };
    });
    expect(result.before).toEqual({ width: 500, lines: 1 });
    expect(result.after.width).toBe(120);
    expect(result.after.height).toBe(400);
    expect(result.after.textWidth).toBe(100);
    expect(result.after.lines).toBeGreaterThan(2);
    expect(result.size).toMatchObject({ width: 120, height: 400 });
  });

  it('routes pointer input to the node under it, and scrolls natively', async () => {
    const stage = await page.evaluate(async () => {
      const stage = window.stage(200, 200);
      stage.id = 'stage';
      const { Engine, wasmUrl } = window.soundor;
      const engine = await Engine.create({ wasmUrl });
      const log: string[] = [];
      (window as unknown as { log: string[] }).log = log;
      const button = engine.root.appendChild(
        engine.createView({ height: 40, backgroundColor: 'teal' }),
      );
      button.addEventListener('pointerdown', () => log.push('down'));
      button.addEventListener('click', () => log.push('click'));
      const list = engine.root.appendChild(
        engine.createView({ height: 100, overflowY: 'scroll' }),
      );
      list.addEventListener('scroll', () =>
        log.push(`scroll ${list.scrollTop}`),
      );
      for (let i = 0; i < 10; i++)
        list.appendChild(engine.createView({ height: 30, flexShrink: 0 }));
      (window as unknown as { list: UiNode }).list = list;
      engine.mount(stage);
      engine.flushLayout();
      const rect = stage.getBoundingClientRect();
      return { x: rect.left, y: rect.top };
    });
    await page.mouse.click(stage.x + 50, stage.y + 20);
    await page.mouse.move(stage.x + 50, stage.y + 90);
    await page.mouse.wheel(0, 120);
    await page.waitForFunction(() =>
      (window as unknown as { log: string[] }).log.some((entry) =>
        entry.startsWith('scroll'),
      ),
    );
    const result = await page.evaluate(() => {
      const { list, log } = window as unknown as {
        list: UiNode;
        log: string[];
      };
      return {
        log: log.filter((entry) => !entry.startsWith('scroll')),
        scrollTop: list.scrollTop,
        scrollHeight: list.scrollHeight,
        clientHeight: list.clientHeight,
      };
    });
    expect(result.log).toEqual(['down', 'click']);
    expect(result.scrollHeight).toBe(300);
    expect(result.clientHeight).toBe(100);
    expect(result.scrollTop).toBe(120);
  });

  it('blocks disabled subtree input and focus while keeping hover and read-only input', async () => {
    const stage = await page.evaluate(async () => {
      const { Engine, wasmUrl, element } = window.soundor;
      const stage = window.stage(200, 200);
      const engine = await Engine.create({ wasmUrl });
      const panel = engine.root.appendChild(engine.createView({ height: 80 }));
      const child = panel.appendChild(engine.createView({ height: 40 }));
      const sibling = engine.root.appendChild(
        engine.createView({ height: 40 }),
      );
      child.focusable = sibling.focusable = true;
      child.accessibility = { role: 'adjustable', state: { readOnly: true } };
      const log: string[] = [];
      for (const type of [
        'pointerenter',
        'pointerdown',
        'pointerup',
        'pointercancel',
        'click',
        'dblclick',
        'contextmenu',
        'wheel',
        'keydown',
        'blur',
      ])
        child.addEventListener(type, () => log.push(type));
      panel.addEventListener('click', () => log.push('panel click'));
      Object.assign(window, { disabledInput: { panel, child, sibling, log } });
      element(child).id = 'control';
      engine.mount(stage);
      engine.flushLayout();
      const { x, y } = stage.getBoundingClientRect();
      return { x: x + 20, y: y + 20 };
    });
    await page.mouse.move(stage.x, stage.y);
    await page.mouse.down();
    const focus = await page.evaluate(() => {
      const { panel, child, sibling } = (
        window as unknown as {
          disabledInput: { panel: UiNode; child: UiNode; sibling: UiNode };
        }
      ).disabledInput;
      const wasFocused = child.focused;
      panel.accessibility = { state: { disabled: true } };
      child.focus();
      (window.soundor.element(child) as HTMLElement).focus();
      return {
        wasFocused,
        child: child.focused,
        sibling: sibling.focused,
        dom: document.activeElement?.id,
      };
    });
    expect(focus).toEqual({
      wasFocused: true,
      child: false,
      sibling: false,
      dom: '',
    });
    expect(await page.locator('#control').getAttribute('aria-disabled')).toBe(
      'true',
    );
    expect(await page.locator('#control').getAttribute('aria-readonly')).toBe(
      'true',
    );
    await page.mouse.up();
    await page.mouse.dblclick(stage.x, stage.y);
    await page.mouse.click(stage.x, stage.y, { button: 'right' });
    await page.mouse.wheel(0, 10);
    await page.keyboard.press('Tab');
    const result = await page.evaluate(() => {
      const { panel, sibling, log } = (
        window as unknown as {
          disabledInput: { panel: UiNode; sibling: UiNode; log: string[] };
        }
      ).disabledInput;
      panel.accessibility = {};
      return { tabbed: sibling.focused, log: log.splice(0) };
    });
    expect(result).toEqual({
      tabbed: true,
      log: ['pointerenter', 'pointerdown', 'blur', 'pointercancel'],
    });
    expect(
      await page.locator('#control').getAttribute('aria-disabled'),
    ).toBeNull();
    await page.mouse.click(stage.x, stage.y);
    await page.keyboard.press('Enter');
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as {
              disabledInput: { log: string[] };
            }
          ).disabledInput.log,
      ),
    ).toEqual(['pointerdown', 'pointerup', 'click', 'panel click', 'keydown']);
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
        a: [a.core.nodeCount, a.root.children[0]!.layout],
        b: [b.core.nodeCount, b.root.children[1]!.layout],
      };
      a.dispose();
      out.b.push(b.root.children[1]!.layout.x);
      return out;
    });
    expect(result.a).toEqual([3, { x: 0, y: 0, width: 100, height: 100 }]);
    expect(result.b).toEqual([4, { x: 10, y: 0, width: 20, height: 50 }, 10]);
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
      // Its observers are gone: resizing calls into no disposed engine.
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
      const { Engine, wasmUrl, element } = window.soundor;
      const missing = await Engine.create({ wasmUrl: '/missing.wasm' }).then(
        () => 'loaded',
        (error: Error) => error.message,
      );
      const engine = await Engine.create({ wasmUrl });
      const box = engine.root.appendChild(
        engine.createView({ height: 10, backgroundColor: 'red' }),
      );
      engine.mount(window.stage(100, 100));
      let thrown = '';
      try {
        box.style = { height: 10, backgroundColor: 'nope' };
      } catch (error) {
        thrown = `${(error as Error).name}: ${(error as Error).message}`;
      }
      return {
        missing,
        thrown,
        background: getComputedStyle(element(box)).backgroundColor,
      };
    });
    // Vite answers a missing file with its page: not WebAssembly either.
    expect(result.missing).toMatch(
      /missing\.wasm is not the Soundor engine's WebAssembly/,
    );
    expect(result.thrown).toBe(
      "TypeError: style.backgroundColor: expected a CSS color, got 'nope'",
    );
    // The last good style is still drawn.
    expect(result.background).toBe('rgb(255, 0, 0)');
  });
});
