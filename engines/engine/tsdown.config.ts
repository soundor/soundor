import { writeFileSync } from 'node:fs';

import { node, withPreset } from '@soundor/tsdown-config';
import { defineConfig } from 'tsdown';

import { loweringInputs } from './scripts/engine-inputs.mjs';

export default defineConfig(
  withPreset(node, {
    entry: ['scripts/native-module.ts'],
    tsconfig: './tsconfig.node.json',
    dts: true,
    // Freeze runtime lowering code with the engine release. Keep declaration
    // imports external: NativeModuleOptions references Babel's input types.
    deps: {
      alwaysBundle: () => true,
      onlyImport: ['@babel/core'],
      dts: { neverBundle: true, alwaysBundle: () => false },
    },
    onSuccess() {
      writeFileSync(
        new URL('./dist/lowering-inputs.json', import.meta.url),
        JSON.stringify(loweringInputs(import.meta.dirname).dependencies),
      );
    },
  }),
);
