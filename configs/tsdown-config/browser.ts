import type { UserConfig } from 'tsdown';

export const browser: UserConfig = {
  platform: 'browser',
  sourcemap: true,
  clean: false,
  format: ['esm'],
  dts: true,
  target: 'es2020',
};
