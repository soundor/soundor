import { node, withPreset } from '@soundor/tsdown-config';
import { defineConfig } from 'tsdown';

export default defineConfig(
  withPreset(node, {
    entry: ['scripts/native-module.ts'],
    tsconfig: './tsconfig.node.json',
    dts: true,
  }),
);
