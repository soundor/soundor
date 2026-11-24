import { writeFileSync } from 'node:fs';

import {
  browser,
  node,
  thirdPartyNotices,
  withPreset,
} from '@soundor/tsdown-config';
import { defineConfig } from 'tsdown';

import { loweringInputs } from './scripts/engine-inputs.mjs';

export default defineConfig([
  withPreset(node, {
    entry: ['scripts/native-module.ts'],
    tsconfig: './tsconfig.node.json',
    dts: true,
    // Freeze runtime lowering code with the engine release. The public
    // declarations use engine-owned types and need no Babel installation.
    deps: {
      alwaysBundle: () => true,
      onlyImport: [],
      dts: { neverBundle: true, alwaysBundle: () => false },
    },
    // Babel and what it uses ship inlined, so their notices ship beside it
    // (dist/licenses/); the VST3 runtime takes @babel/helpers' from there
    // for plugins, whose code gets Babel's helpers.
    plugins: [thirdPartyNotices({ title: '@soundor/engine/native-module' })],
    onSuccess() {
      writeFileSync(
        new URL('./dist/lowering-inputs.json', import.meta.url),
        JSON.stringify(loweringInputs(import.meta.dirname).dependencies),
      );
    },
  }),
  // @soundor/engine: engine(), the artifacts for build tooling (node/). Its
  // selection scripts are bundled as the npm package also ships them.
  withPreset(node, {
    entry: { index: 'node/src/index.ts', archives: 'node/src/archives.ts' },
    tsconfig: './tsconfig.node.json',
    dts: true,
  }),
  // @soundor/engine/web: the WebAssembly engine's JavaScript (its module is
  // built apart, by build:wasm); /web/processor: the Rust processor's host,
  // apart so a page with a UI alone loads none of it.
  withPreset(browser, {
    entry: {
      web: 'web/src/index.ts',
      'web/processor': 'web/src/processor/index.ts',
    },
    tsconfig: './web/tsconfig.json',
    target: 'es2022',
  }),
]);
