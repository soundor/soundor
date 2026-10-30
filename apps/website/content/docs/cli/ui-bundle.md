---
title: 'The UI bundle'
description: 'How dev and build bundle src/main.tsx: what is inlined, assets, modes, and the TypeScript setup.'
---

A plugin's UI is TypeScript or TSX in `src/main.tsx` (or `main.ts`, `main.jsx`,
`main.js`). [`soundor dev`](/docs/cli/dev) and [`soundor build`](/docs/cli/build) bundle it with
[tsdown](https://tsdown.dev) into one JavaScript file, an ES module, that each
runtime runs:

- Everything it imports from npm is inlined. `soundor:*` modules stay imports;
  the runtime provides them.
- `build` minifies and tree-shakes into `.soundor/ui/production`. `dev` keeps
  source maps, in `.soundor/ui/development`.
- TSX uses the automatic JSX runtime (set `"jsx": "react-jsx"` in the
  tsconfig). `process.env.NODE_ENV` is replaced at build time, since the runtime
  has no `process`.
- `import logo from './logo.png'` (also `.jpg`, `.jpeg`, `.webp`) bundles the
  image as an asset and yields its stable, content-derived id; so does
  `import inter from './Inter.ttf'` (also `.otf`) for a font, which
  [`registerFont`](/docs/components/text#fonts) takes. Only the files the
  bundle still uses after tree shaking are shipped: a library's font helper
  that the plugin never calls adds none.

Each build is `bundle.mjs` (and `bundle.mjs.map` in development). The web
runtime loads it as it is. The JUCE runtime lowers it into the module form its
engine runs, with that engine's own lowering, and its release builds compile
the result to Hermes bytecode.

## TypeScript

TypeScript types for the runtime are generated into
`.soundor/generated/soundor.d.ts`: the `soundor:*` modules, image and font
imports (their ids, plain strings), and exactly the Web APIs the runtime
provides. Use them with `lib: ["ES2023"]` and
without `"DOM"`, so code that assumes a browser fails to compile:

```jsonc
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "types": [],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "bundler",
  },
  "include": ["src", ".soundor/generated/soundor.d.ts"],
}
```

The bundler never ships with the plugin: the plugin contains plain JavaScript
only.
