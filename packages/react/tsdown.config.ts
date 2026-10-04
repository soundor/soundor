import { browser, withPreset } from '@soundor/tsdown-config';
import { defineConfig } from 'tsdown';

export default defineConfig(
  withPreset(browser, {
    entry: ['src/index.ts'],
    platform: 'neutral',
    target: 'es2023',
    tsconfig: './tsconfig.app.json',
    dts: true,
    // The runtime provides soundor:*; the plugin's bundle inlines React.
    deps: {
      neverBundle: [
        /^soundor:/,
        'react',
        /^react\//,
        'react-reconciler',
        /^react-reconciler\//,
      ],
    },
  }),
);
