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
    entry: {
      'client/index': 'src/client/index.ts',
      'client/modules/host': 'src/client/modules/host.ts',
      'client/modules/state': 'src/client/modules/state.ts',
      'client/modules/presets': 'src/client/modules/presets.ts',
      'client/modules/state-history': 'src/client/modules/state-history.ts',
      'client/modules/parameters': 'src/client/modules/parameters.ts',
      'client/modules/ui': 'src/client/modules/ui.ts',
      'client/modules/storage': 'src/client/modules/storage.ts',
      'client/modules/fs': 'src/client/modules/fs.ts',
      'client/native-bridge': 'src/client/native-bridge.ts',
    },
    target: 'es2022',
    tsconfig: './tsconfig.client.json',
    dts: true,
    // The runtime's Vite plugin provides soundor:* to the page. The SDK's
    // client entry (core's springs, the same as the test runtime's) is
    // inlined: the page gets no import of it to resolve.
    deps: {
      neverBundle: [/^soundor:/],
      alwaysBundle: ['@soundor/runtime-sdk/client'],
    },
    outputOptions: { chunkFileNames: 'client/[name]-[hash].js' },
  }),
]);
