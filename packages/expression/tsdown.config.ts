import { node, withPreset } from '@soundor/tsdown-config';
import { defineConfig } from 'tsdown';

export default defineConfig(
  withPreset(node, {
    entry: ['src/index.ts', 'src/compiler/cpp.ts', 'src/compiler/js.ts'],
    tsconfig: './tsconfig.app.json',
    dts: true,
  }),
);
