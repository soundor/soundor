/**
 * Builds the playground script (`playground/kit.ts`) into
 * `public/playground/kit.js`: one classic script with React, `@soundor/react`
 * and the compiler, whose `soundor:*` imports read the host's modules from
 * `globalThis.__soundorModules` (`@soundor/web-runtime`'s playground mode
 * sets it before loading the script).
 */

import { build } from 'rolldown';

await build({
  input: new URL('../playground/kit.ts', import.meta.url).pathname,
  platform: 'browser',
  external: [/^soundor:/],
  transform: {
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  },
  output: {
    file: new URL('../public/playground/kit.js', import.meta.url).pathname,
    format: 'iife',
    globals: (id) => `globalThis.__soundorModules[${JSON.stringify(id)}]`,
    minify: true,
    sourcemap: true,
  },
});
console.log('Playground script: public/playground/kit.js');
