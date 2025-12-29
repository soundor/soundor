import type { UserConfig } from 'tsdown';

export const node: UserConfig = {
  platform: 'node',
  sourcemap: true,
  clean: true,
  format: ['esm'],
  dts: true,
};
