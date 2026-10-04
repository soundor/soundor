import { browser, node, withPreset } from '@soundor/tsdown-config';
import { defineConfig } from 'tsdown';

export default defineConfig([
  // The runtime and the Vite integration, for Node.
  withPreset(node, {
    entry: ['src/index.ts', 'src/vite.ts'],
    tsconfig: './tsconfig.node.json',
    dts: true,
  }),
  // The Web host, for the browser. Kept apart so no Node code reaches it.
  withPreset(browser, {
    entry: { 'client/index': 'src/client/index.ts' },
    target: 'es2022',
    tsconfig: './tsconfig.client.json',
    dts: true,
    // The runtime's Vite plugin provides soundor:* to the page.
    deps: { neverBundle: [/^soundor:/] },
  }),
]);
