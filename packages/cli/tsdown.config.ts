import { node, withPreset } from '@soundor/tsdown-config';
import { defineConfig } from 'tsdown';

export default defineConfig(
  withPreset(node, {
    entry: ['src/index.ts'],
    dts: false,
    banner: { js: '#!/usr/bin/env node' },
  }),
);
