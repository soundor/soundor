import { node, withPreset } from '@soundor/tsdown-config';
import { defineConfig } from 'tsdown';

export default defineConfig(
  withPreset(node, {
    entry: ['src/index.ts'],
    tsconfig: './tsconfig.app.json',
    dts: false,
    banner: { js: '#!/usr/bin/env node' },
  }),
);
