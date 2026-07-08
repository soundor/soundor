import { browser, node, withPreset } from '@soundor/tsdown-config';
import { defineConfig } from 'tsdown';

// Two entries with different targets: the runtime factory + host phases run in
// Node (`index.ts`); the client bridge runs in the browser WebView (`bridge.ts`).
export default defineConfig([
  withPreset(node, {
    entry: ['src/index.ts'],
    tsconfig: './tsconfig.node.json',
    dts: true,
  }),
  withPreset(browser, {
    entry: ['src/bridge.ts'],
    tsconfig: './tsconfig.browser.json',
    dts: true,
  }),
]);
