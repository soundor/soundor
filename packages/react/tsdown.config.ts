import { browser, withPreset } from '@soundor/tsdown-config';
import { defineConfig } from 'tsdown';

export default defineConfig(
  withPreset(browser, {
    entry: ['src/index.ts'],
  }),
);
