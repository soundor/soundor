import { browser, withPreset } from '@soundor/tsdown-config';
import { defineConfig } from 'tsdown';

export default defineConfig(
  withPreset(browser, {
    entry: ['src/index.ts'],
    target: 'es2022',
    tsconfig: './tsconfig.json',
    dts: true,
    // Published beside the code: what `scripts/prepare.mjs` reads back to reuse
    // a module whose inputs have not changed.
    copy: [
      { from: 'generated/yoga.wasm', to: 'dist' },
      { from: 'generated/build.json', to: 'dist' },
    ],
  }),
);
