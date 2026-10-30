---
title: 'Writing a UI library'
description: 'Publish components for Soundor plugins: the runtime types, your own build, and shipping images and fonts.'
---

A UI library for Soundor plugins, such as a set of knobs or a theme, is an
ordinary npm package. It imports `soundor:*` modules (or `@soundor/react`),
which the plugin's runtime provides, and it is built with whatever bundler you
like. The plugin's own bundler inlines it like any other dependency.

## The runtime types

`@soundor/core` publishes the declarations of what the runtime provides that
are the same for every plugin: `soundor:ui`, image and font imports, and
exactly the Web globals the runtime has, in place of the DOM. A plugin gets the
same, generated with its own parameters and native API, in
`.soundor/generated`. `soundor:parameters` and `soundor:native` are specific
to each plugin, so a library takes values from them as arguments rather than
importing them.

Add `@soundor/core` as a development dependency (it has no dependencies of its
own) and name its runtime types in your tsconfig:

```jsonc
{
  "compilerOptions": {
    // Soundor's runtime: ES2023 and the Web subset it declares, no DOM.
    "lib": ["ES2023"],
    "types": ["@soundor/core/runtime"],
  },
}
```

Without `"DOM"`, code that touches `window` or `document`, which the runtime
does not have, fails to compile instead of failing in a plugin.

`@soundor/core/runtime` is three files, which a library can also include
apart, from `node_modules/@soundor/core/runtime/`:

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

Keep the files in the package and import them, as a plugin does. Your build
must leave those imports as they are, so that the plugin's bundler finds the
files and bundles them as assets: mark them external (with tsdown,
`external: [/\.(png|jpe?g|webp|ttf|otf)$/]`) and publish the files.

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

A font is registered by the code that uses it, once:

```ts
import { registerFont } from 'soundor:ui';

import brand from '../assets/Brand.ttf';

export const fontsReady = registerFont('Brand', brand);
```

Leave `soundor:*` and `@soundor/react` external too (a peer dependency for
`@soundor/react`), so the plugin's own copy is the only one.
