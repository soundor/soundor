import type { UserConfig } from 'tsdown';

export const browser: UserConfig = {
  platform: 'browser',
  sourcemap: true,
  clean: true,
  format: ['esm'],
  dts: true,
  target: 'es2020',
};
