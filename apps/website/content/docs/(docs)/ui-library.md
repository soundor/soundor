---
title: 'Writing a UI library'
description: 'Publish components for Soundor plugins: the runtime types, your own build, and shipping images and fonts.'
---

A UI library for Soundor plugins, such as a set of knobs or a theme, is an
ordinary npm package. It imports `soundor:*` modules (or `@soundor/react`),
which the plugin's runtime provides, and it is built with whatever bundler you
like. The plugin's own bundler inlines it like any other dependency.

## The runtime types

`@soundor/environment` declares what the runtime provides that is the same for
every plugin: `soundor:ui`, image and font imports, and
exactly the Web globals the runtime has, in place of the DOM. A plugin gets the
same, generated with its own parameters and native API, in
`.soundor/generated`. `soundor:parameters` and `soundor:native` are specific
to each plugin, so a library takes values from them as arguments rather than
importing them.

Add `@soundor/environment`, which holds these declarations and nothing else, as
a development dependency, and name it in your tsconfig:

```jsonc
{
  "compilerOptions": {
    // Soundor's runtime: ES2023 and the Web subset it declares, no DOM.
    "lib": ["ES2023"],
    "types": ["@soundor/environment"],
  },
}
```

Without `"DOM"`, code that touches `window` or `document`, which the runtime
does not have, fails to compile instead of failing in a plugin.

`@soundor/environment` is three files, which a library can also include
apart, from `node_modules/@soundor/environment/`:

| File           | Declares                                                              |
| -------------- | --------------------------------------------------------------------- |
| `ui.d.ts`      | `soundor:ui`: nodes, styles, events, canvases, fonts, `Asset`         |
| `assets.d.ts`  | Image and font imports (`import logo from './logo.png'`) as strings   |
| `globals.d.ts` | Exactly the Web globals the runtime provides, instead of the full DOM |

Leave out `assets.d.ts` when your toolchain declares image imports itself, as
Vite's `vite/client` does: the two clash. Code that also runs in a plain web
page uses `"DOM"` in place of `globals.d.ts` (never both, as they clash too);
`ui.d.ts` needs only standard Web types (`EventTarget`, canvas contexts), which
the DOM's declare as well.

An asset is its id, a plain `string` (`Asset` in `soundor:ui`), so an image
import typed by another bundler fits wherever `soundor:ui` or `@soundor/react`
takes one.

## Images and fonts

An image or font is imported, as a plugin does, and the plugin's bundler
bundles the file as an asset. Your build must leave that import as it is, so
that the plugin's bundler finds the file. Fonts need TrueType (`.ttf`) or
OpenType (`.otf`) files: the native runtime does not read WOFF or WOFF2, the
formats of web font packages such as Fontsource.

### Fonts in a package of their own

A set of fonts is best published as a package of its own, with the files in
its `exports`:

```json
{
  "name": "@acme/fonts",
  "exports": {
    "./ttf/*": "./ttf/*"
  },
  "files": ["ttf", "LICENSE"]
}
```

A library or a plugin imports a file by the package's name, with the package
in its `dependencies`. Your bundler leaves a dependency's imports external
already, and the path does not depend on where your build writes its output:

```ts
import brandRegular from '@acme/fonts/ttf/Brand-Regular.ttf';
```

### Files in your library

A library can also keep the files in its own package. Mark them external
(with tsdown, `external: [/\.(png|jpe?g|webp|ttf|otf)$/]`) and publish them.
The import's path is resolved from the built file, not the source: keep the
same relative path between them. With `src/index.ts` built to
`dist/index.mjs`, put the files in a directory beside both, such as `assets/`,
and import `../assets/Brand.ttf`:

```text
my-knobs/
  assets/Brand.ttf
  src/index.ts      import brand from '../assets/Brand.ttf'
  dist/index.mjs    (import brand from '../assets/Brand.ttf', kept)
  package.json      "files": ["dist", "assets"]
```

### Registering fonts

Export a function that registers your fonts, rather than registering them when
your module is imported:

```ts
import brandBold from '@acme/fonts/ttf/Brand-Bold.ttf';
import brandRegular from '@acme/fonts/ttf/Brand-Regular.ttf';
import { registerFont } from 'soundor:ui';

export function registerBrandFonts(): Promise<void[]> {
  return Promise.all([
    registerFont('Brand', brandRegular, { weight: 400 }),
    registerFont('Brand', brandBold, { weight: 700 }),
  ]);
}
```

A plugin ships only the images and fonts its bundle still uses after tree
shaking. One that calls `registerBrandFonts()` gets the files; one that uses
your components with fonts of its own, registered with `registerFont()`, ships
none of yours. Registering at the top level of a module is a side effect, which
keeps the fonts in every plugin that imports the module.

The bundler needs to see each file's path, so import every file by name. A
list of file names read at run time, such as a manifest, cannot be bundled.

Leave `soundor:*` and `@soundor/react` external too (a peer dependency for
`@soundor/react`), so the plugin's own copy is the only one.
