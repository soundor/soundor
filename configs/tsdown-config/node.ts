import type { UserConfig } from 'tsdown';

export const node: UserConfig = {
  platform: 'node',
  sourcemap: true,
  clean: false,
  format: ['esm'],
  dts: true,
};
