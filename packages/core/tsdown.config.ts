import { node, withPreset } from '@soundor/tsdown-config';
import { defineConfig } from 'tsdown';

export default defineConfig(
  withPreset(node, {
    entry: ['src/index.ts', 'src/spring.ts', 'src/state.ts', 'src/presets.ts'],
    tsconfig: './tsconfig.app.json',
    dts: true,
  }),
);
