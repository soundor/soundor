---
title: 'Third-party notices'
description: 'The license notices every build ships for what it contains, how Soundor finds them, and how to add or correct one.'
---

A plugin contains more than its own code: the Soundor engine and what it
links (Skia, Hermes, Yoga...), the npm packages its UI imports, the Rust
crates its library uses, Rust's standard library, and fonts or images from
packages. Most of these come with a permissive license (MIT, BSD, Apache-2.0,
ISC, the OFL for fonts) that asks for its notice to go with every copy,
compiled ones included.

So every build ships those notices, found on its own from what the build
actually contains, in a `licenses/` folder beside the plugin:

- **VST3**: `<Name>.vst3/Contents/Resources/licenses/`
- **Web**: `.soundor/dist/web/licenses/`, which the host page links to

Distribute that folder with the plugin as it is, and don't strip it from the
bundle. Your plugin's own license is yours to choose and to ship; it is not
listed there.

## What the folder holds

```text
licenses/
  THIRD-PARTY-NOTICES.txt      every component, then each one's license texts
  licenses.json                the same, for tools
  engine/<component>/          what the engine contains (VST3: Skia, Hermes, ANGLE,
                               Yoga, ada...; web: the engine's core, Yoga, Emscripten's libc)
  vst3-sdk/                    Steinberg's VST3 SDK (VST3 only)
  javascript/<package>@<ver>/  npm packages in the UI (on VST3 with @babel/helpers, whose
                               helpers the engine's lowering adds), and on the web the host page's
  rust/<crate>@<ver>/          crates linked into the plugin, and Rust's std
  project/<name>/              your files with their own license, and what the config adds
```

Each component's folder holds its license files as they are.
`THIRD-PARTY-NOTICES.txt` lists every component, then each one's texts, in
one file people can open. `licenses.json` lists each component with its
version, license (an SPDX expression, when known), where the notice came from
(`found`, `override`, `added` or `excluded`) and its files.

## How the notices are found

- **npm packages** are counted from the files the bundle kept after tree
  shaking: a package only your dead code imports is not in the build, so not
  in the list. Each file takes the license files nearest to it in its
  package. So a font next to its `OFL.txt` gets the OFL, and the package's code
  gets the root `LICENSE`. One package can ship several texts this way: a
  component library's MIT for its code, and the OFL of the font it bundles.
- **Rust crates** are the ones your library links for the build's target,
  as Cargo resolves them: normal dependencies, transitively. Build and dev
  dependencies and procedural macros only run while compiling, so they are
  left out. Each crate gives its `license-file`, or the license files in its
  folder.
- **Rust's standard library**, which every Rust binary links, ships the
  notices the Rust toolchain provides for it, `COPYRIGHT-library.html`
  (installed with Rust by rustup).
- **The engine and the VST3 SDK** come with their own notices, in their
  prebuilt archives and in the engine's npm package.
- **Your own files** need nothing. A file of yours with a license file next
  to it (say `src/fonts/Inter.ttf` beside `src/fonts/OFL.txt`) gets that
  notice under `project/`. The project's root `LICENSE` is yours and is never
  listed. In a monorepo, files outside the project in a private package (the
  repository's root `package.json`, a shared package of yours) are yours too:
  a logo in `assets/brand/` beside its own `LICENSE.md` ships that notice as
  `project/assets/brand/`.

When a component's license text cannot be found, the build stops and names
it, with the config that fixes it; `soundor dev` only warns, so a dependency
you are trying out never blocks development. A package that declares
`"license": "MIT"` but ships no `LICENSE` file is the usual case.

## Adding or correcting a notice

`licenses` in [`soundor.config.ts`](/docs/cli/config#licenses) is for what the
build cannot find on its own:

```ts
export default defineSoundorConfig({
  // ...
  licenses: {
    // What the build cannot see: samples or impulse responses loaded at run
    // time, data a crate embeds, code copied into the project.
    add: [
      {
        name: 'Hall impulse responses',
        license: 'CC-BY-4.0',
        file: './licenses/impulse-responses.txt',
      },
    ],
    // A package whose notice is missing or wrong, or one of your own
    // (false: ship no notice for it).
    packages: {
      'tiny-color-lib': {
        license: 'MIT',
        file: './licenses/tiny-color-lib.txt',
      },
      '@acme/internal-ui': false,
    },
    // The same for crates; `std` is Rust's standard library.
    crates: {
      'dsp-kernels': {
        license: 'BSD-3-Clause',
        file: './licenses/dsp-kernels.txt',
      },
    },
  },
});
```

- `file` is relative to the config. `license` is an SPDX expression, which
  goes into `licenses.json`.
- An override replaces the notice found for that package or crate, for
  every version of it in the build.
- `false` ships no notice. Use it for private packages of your own, never for
  someone else's code. It still appears in `licenses.json`, as `excluded`.
- An override that matches nothing in the build gets a warning, so stale
  entries do not linger.

## Checking before a release

[`soundor licenses`](/docs/cli/licenses) lists what each runtime's build
would ship, without building it:

```sh
soundor licenses        # every runtime
soundor licenses vst3   # one
```

Every `soundor build` also logs a one-line summary, such as
`Licenses: 14 components (MIT 6, MIT OR Apache-2.0 1, other 7)`. "Other" counts
the prebuilt parts whose texts say their license.

## For library authors

A package that ships assets under another license than its code works
without any setup when each asset's license file is in its folder, or the
closest folder above it, and the package's own `LICENSE` is at its root.
Plugins built with it then ship exactly the notices of the assets they use.
