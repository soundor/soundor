// What the WebAssembly engine costs in a browser (`pnpm bench:wasm` runs it
// in Chromium; open bench.html and call runBench() by hand elsewhere). Each
// figure is the median of several runs, in milliseconds.
import { Engine, type UiNode } from '../src/index.ts';

declare global {
  interface Window {
    runBench: () => Promise<Results>;
  }
}

type Results = Record<string, number | string>;

const wasmUrl = '/soundor-core.wasm';

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

async function time(runs: number, run: () => unknown): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await run();
    times.push(performance.now() - start);
  }
  return median(times);
}

/** Counts the canvas's measureText() calls: the engine's measurements. */
function countMeasurements(): () => number {
  let count = 0;
  for (const prototype of [
    OffscreenCanvasRenderingContext2D.prototype,
    CanvasRenderingContext2D.prototype,
  ]) {
    const original = prototype.measureText;
    prototype.measureText = function (this: never, text: string) {
      count++;
      return original.call(this, text);
    } as typeof original;
  }
  return () => count;
}

const words =
  'Gain Drive Tone Mix Attack Release Ratio Threshold Cutoff Resonance Depth Rate Feedback Width'.split(
    ' ',
  );

/**
 * A plugin-sized UI: `rows` rows, each a label, a value and `cells` boxes:
 * rows × (cells + 4) nodes.
 */
function build(engine: Engine, rows: number, cells: number): UiNode[] {
  engine.root.style = { padding: 8, gap: 4 };
  const boxes: UiNode[] = [];
  for (let row = 0; row < rows; row++) {
    const line = engine.root.appendChild(
      engine.createView({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        padding: 4,
        borderWidth: 1,
        borderColor: '#ccc',
      }),
    );
    line.appendChild(
      engine.createText(`${words[row % words.length]} ${row}`, {
        width: 120,
        fontSize: 13,
      }),
    );
    line.appendChild(
      engine.createText(
        `${(row * 0.37).toFixed(2)} dB, the value of this row`,
        {
          flex: 1,
          fontSize: 12,
          numberOfLines: 2,
        },
      ),
    );
    for (let cell = 0; cell < cells; cell++)
      boxes.push(
        line.appendChild(
          engine.createView({
            width: 12,
            height: 12,
            borderRadius: 2,
            backgroundColor: '#4f46e5',
          }),
        ),
      );
  }
  return boxes;
}

window.runBench = async (): Promise<Results> => {
  const results: Results = {
    crossOriginIsolated: String(crossOriginIsolated),
    userAgent: navigator.userAgent,
  };
  const stage = document.getElementById('stage')!;
  const measured = countMeasurements();

  // Loading: downloading and compiling the module, and starting an engine
  // from a module compiled already (each later engine).
  results['module fetch + compile'] = await time(10, async () => {
    await WebAssembly.compileStreaming(fetch(`${wasmUrl}?${Math.random()}`));
  });
  const module = await WebAssembly.compileStreaming(fetch(wasmUrl));
  results['engine start (compiled module)'] = await time(20, async () => {
    (await Engine.create({ wasm: module })).dispose();
  });
  results['first engine (fetch, compile, start)'] = await time(5, async () => {
    (
      await Engine.create({
        wasm: await WebAssembly.compileStreaming(
          fetch(`${wasmUrl}?${Math.random()}`),
        ),
      })
    ).dispose();
  });

  // The first layout of a 1200-node UI: the tree written (JavaScript), laid
  // out (one call: the C++ core, with text measured by the browser or by the
  // approximation), and shown (elements created, the browser's own style and
  // layout of them forced).
  const rows = 120;
  const cells = 6;
  for (const textMeasurement of ['browser', 'approximate'] as const) {
    const build_: number[] = [];
    const layout: number[] = [];
    const show: number[] = [];
    const counts: number[] = [];
    for (let run = 0; run < 7; run++) {
      const engine = await Engine.create({ wasm: module, textMeasurement });
      const before = measured();
      let start = performance.now();
      build(engine, rows, cells);
      build_.push(performance.now() - start);
      engine.core.setSize(1024, 768);
      start = performance.now();
      engine.flushLayout();
      layout.push(performance.now() - start);
      counts.push(measured() - before);
      start = performance.now();
      engine.mount(stage);
      void stage.getBoundingClientRect().width;
      void document.body.offsetHeight;
      show.push(performance.now() - start);
      engine.dispose();
    }
    const suffix = textMeasurement === 'browser' ? '' : ' (approximate text)';
    results[`nodes`] = rows * (cells + 4) + 1;
    results[`initial: build tree in JS${suffix}`] = median(build_);
    results[`initial: layout (one call)${suffix}`] = median(layout);
    results[`initial: mount DOM + browser layout${suffix}`] = median(show);
    if (textMeasurement === 'browser')
      results['initial: measureText() calls'] = median(counts);
  }

  // Updates, on a laid-out tree: a resize of the whole UI (everything moves,
  // text rewraps), a style change of 60 boxes, a text change, and a batch
  // with no change.
  {
    const engine = await Engine.create({ wasm: module });
    const boxes = build(engine, rows, cells);
    engine.mount(stage);
    engine.flushLayout();
    const texts = engine.root.children.map((row) => row.children[1]!);
    let width = 1024;
    const before = measured();
    results['update: resize, relayout + DOM'] = await time(40, () => {
      width = width === 1024 ? 700 : 1024;
      engine.core.setSize(width, 768);
      engine.flushLayout();
    });
    results['update: resize, measureText() calls per relayout'] =
      (measured() - before) / 40;
    let size = 12;
    results['update: 60 styles, relayout + DOM'] = await time(40, () => {
      size = size === 12 ? 14 : 12;
      for (let i = 0; i < boxes.length; i += 12)
        boxes[i]!.style = {
          width: size,
          height: size,
          borderRadius: 2,
          backgroundColor: '#4f46e5',
        };
      engine.flushLayout();
    });
    let flip = false;
    results['update: one text, relayout + DOM'] = await time(40, () => {
      flip = !flip;
      texts[3]!.text = flip
        ? 'a longer value that will wrap onto a second line'
        : 'short';
      engine.flushLayout();
    });
    results['update: no change (flush)'] = await time(200, () =>
      engine.flushLayout(),
    );
    // A batch that changes nothing (a box given the style it has): one call
    // into the module and back, with the scan of every node for changes.
    const same = boxes[0]!.style;
    results['boundary: one call, nothing changed (1201 nodes scanned)'] =
      await time(200, () => {
        boxes[0]!.style = same;
        engine.flushLayout();
      });
    engine.dispose();
  }

  // Text measurement on its own: a canvas measurement, and the engine's
  // wrapping of a paragraph at new widths (each width measures again).
  {
    const context = new OffscreenCanvas(1, 1).getContext('2d')!;
    context.font = '400 14px system-ui, sans-serif';
    const count = 2000;
    const start = performance.now();
    for (let i = 0; i < count; i++)
      context.measureText(`${words[i % words.length]} ${i}`);
    results['text: one measureText() (µs)'] =
      ((performance.now() - start) / count) * 1000;

    const engine = await Engine.create({ wasm: module });
    const paragraph = engine.root.appendChild(
      engine.createText(
        Array.from({ length: 60 }, (_, i) => words[i % words.length]).join(' '),
        {
          fontSize: 14,
        },
      ),
    );
    let paragraphWidth = 300;
    const calls = measured();
    results['text: rewrap a 60-word paragraph'] = await time(60, () => {
      paragraphWidth = paragraphWidth === 300 ? 301 : 300;
      engine.core.setSize(paragraphWidth, 600);
      engine.flushLayout();
    });
    results['text: measureText() calls per rewrap'] = (measured() - calls) / 60;
    void paragraph;
    engine.dispose();
  }
  return results;
};
