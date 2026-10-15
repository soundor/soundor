import { Window } from 'happy-dom';

// React DOM needs browser globals at import time. Each dashboard still owns its
// own window; retain Node's fetch and URL for the real backend and simulator.
const win = new Window();
Object.defineProperties(globalThis, {
  window: { value: win, configurable: true },
  document: { value: win.document, configurable: true },
  navigator: { value: win.navigator, configurable: true },
});
