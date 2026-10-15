import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import { App } from './app';
import { createInspector } from './controller';

export function startInspector(win: Window & typeof globalThis) {
  const inspector = createInspector(win);
  const container = win.document.getElementById('app');
  if (!container) throw new Error('Missing DevTools app container');
  const root = createRoot(container);
  flushSync(() => root.render(<App inspector={inspector} />));
  inspector.start();
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    win.removeEventListener('pagehide', dispose);
    inspector.dispose();
    root.unmount();
  }
  win.addEventListener('pagehide', dispose, { once: true });
  return dispose;
}
