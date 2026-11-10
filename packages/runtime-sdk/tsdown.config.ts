import { node, withPreset } from '@soundor/tsdown-config';
import { defineConfig } from 'tsdown';

export default defineConfig(
  withPreset(node, {
    entry: [
      'src/index.ts',
      'src/client.ts',
      'src/expression/index.ts',
      'src/expression/cpp.ts',
      'src/expression/js.ts',
    ],
    tsconfig: './tsconfig.app.json',
    dts: true,
  }),
);
