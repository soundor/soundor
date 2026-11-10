import { node, withPreset } from '@soundor/tsdown-config';
import { defineConfig } from 'tsdown';

export default defineConfig(
  withPreset(node, {
    entry: ['src/index.ts', 'src/client.ts'],
    tsconfig: './tsconfig.app.json',
    dts: true,
  }),
);
