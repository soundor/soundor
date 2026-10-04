# soundor

Command line interface for creating, developing, validating, and building
Soundor projects.

## Install

```sh
pnpm add -D soundor
```

## Usage

```sh
soundor init      # scaffold the runtimes' host projects
soundor gen       # regenerate .soundor/generated (types, C++ framework)
soundor dev       # development build of the plugin
soundor build     # production build of the plugin
soundor doctor    # check the toolchain
```

## The plugin UI bundle

A plugin's UI is TypeScript or TSX in `src/main.tsx` (or `main.ts`, `main.jsx`,
`main.js`). `soundor dev` and `soundor build` bundle it with
[tsdown](https://tsdown.dev) into one JavaScript file that the plugin embeds
and runs in Soundor's runtime:

- Everything it imports from npm is inlined. `soundor:*` modules stay imports;
  the runtime provides them.
- `build` minifies and tree-shakes into `.soundor/ui/production`. `dev` keeps
  source maps, in `.soundor/ui/development`.
- TSX uses the automatic JSX runtime (set `"jsx": "react-jsx"` in the
  tsconfig). `process.env.NODE_ENV` is replaced at build time, since the runtime
  has no `process`.
- `import logo from './logo.png'` (also `.jpg`, `.jpeg`, `.webp`) bundles the
  image as an asset and yields its stable, content-derived id.

TypeScript types for the runtime are generated into
`.soundor/generated/soundor.d.ts`: the `soundor:*` modules, image imports, and
exactly the Web APIs the runtime provides. Use them with `lib: ["ES2023"]` and
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

## License

MIT
