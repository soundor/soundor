// The fixture's page: a small UI made of the engine's views and text, laid
// out by the C++ core in WebAssembly and shown by the DOM adapter, with
// controls that change it. With ?bare it only exposes the API, for tests.
import { Engine, type EngineNode } from '../src/index.ts';

declare global {
  interface Window {
    /** For the browser tests: the API, and where the module is. */
    soundor: { Engine: typeof Engine; wasmUrl: string };
    /** The demo's engine, while it runs. */
    demo?: Demo;
  }
}

const wasmUrl = '/soundor-core.wasm';
window.soundor = { Engine, wasmUrl };

interface Demo {
  engine: Engine;
  card: EngineNode;
  body: EngineNode;
  items: EngineNode;
}

const words =
  'Soundor lays this text out with the same C++ and Yoga as a plugin, measured with the browser’s fonts and drawn by the browser, one span per line.';

async function start(stage: HTMLElement): Promise<Demo> {
  const engine = await Engine.create({ wasmUrl });
  engine.root.style = { padding: 16, gap: 12, backgroundColor: '#ffffff' };

  const header = engine.root.appendChild(
    engine.createView({
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 12,
      borderRadius: 8,
      backgroundColor: '#111827',
    }),
  );
  header.appendChild(
    engine.createView({
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: '#f59e0b',
    }),
  );
  header.appendChild(
    engine.createText('Soundor engine · WebAssembly', {
      color: '#f9fafb',
      fontSize: 18,
      fontWeight: 'bold',
      flexShrink: 1,
    }),
  );

  const card = engine.root.appendChild(
    engine.createView({
      flexDirection: 'row',
      gap: 12,
      padding: 12,
      borderWidth: 1,
      borderColor: '#d1d5db',
      borderRadius: 8,
      flexShrink: 1,
    }),
  );
  card.appendChild(
    engine.createView({
      width: 64,
      height: 64,
      borderRadius: 4,
      backgroundColor: '#3b82f6',
    }),
  );
  const body = card.appendChild(
    engine.createText(words, {
      flexGrow: 1,
      flexShrink: 1,
      fontSize: 14,
      lineHeight: 20,
      color: '#374151',
    }),
  );

  const items = engine.root.appendChild(
    engine.createView({ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }),
  );
  for (let i = 1; i <= 5; i++) items.appendChild(item(engine, i));

  engine.mount(stage);
  return { engine, card, body, items };
}

function item(engine: Engine, index: number): EngineNode {
  const view = engine.createView({
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: index % 2 ? '#dcfce7' : '#e0e7ff',
  });
  view.appendChild(engine.createText(`Item ${index}`, { fontSize: 13 }));
  return view;
}

function controls(
  root: HTMLElement,
  stage: HTMLElement,
  status: HTMLElement,
): void {
  const button = (label: string, action: (demo: Demo) => void): void => {
    const element = document.createElement('button');
    element.textContent = label;
    element.addEventListener('click', () => {
      if (window.demo) action(window.demo);
      report();
    });
    root.append(element);
  };
  button('Toggle direction', ({ card }) => {
    const row = card.style.flexDirection !== 'column';
    card.style = { ...card.style, flexDirection: row ? 'column' : 'row' };
  });
  button('Bigger text', ({ body }) => {
    body.style = {
      ...body.style,
      fontSize: (body.style.fontSize ?? 14) + 2,
      lineHeight: undefined,
    };
  });
  button('Change text', ({ body }) => {
    body.text = body.text === words ? 'Short now.' : words;
  });
  button('Add item', ({ engine, items }) => {
    items.appendChild(item(engine, items.children.length + 1));
  });
  button('Remove item', ({ items }) => {
    const last = items.children.at(-1);
    if (!last) return;
    for (const child of last.children) child.release();
    last.release();
  });
  button('Narrow', () => {
    stage.style.width = `${Math.max(200, stage.clientWidth - 120)}px`;
  });
  button('Wide', () => {
    stage.style.width = '640px';
  });
  const restart = document.createElement('button');
  restart.textContent = 'Dispose and start again';
  restart.addEventListener('click', async () => {
    window.demo?.engine.dispose();
    window.demo = await start(stage);
    report();
  });
  root.append(restart);

  function report(): void {
    const demo = window.demo;
    if (!demo) return;
    const { width, height } = demo.engine.size;
    status.textContent = `engine nodes: ${demo.engine.nodeCount}\nsize: ${width} × ${height}\ntext lines: ${demo.body.lines.length}`;
  }
  new ResizeObserver(() => queueMicrotask(report)).observe(stage);
}

if (!new URLSearchParams(location.search).has('bare')) {
  const stage = document.getElementById('stage')!;
  window.demo = await start(stage);
  controls(
    document.getElementById('controls')!,
    stage,
    document.getElementById('status')!,
  );
} else {
  document.body.replaceChildren();
}
