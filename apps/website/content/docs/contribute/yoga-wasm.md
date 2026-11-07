---
title: Yoga for the Web
description: "@soundor/yoga-wasm, the engine's Yoga compiled to WebAssembly: where it comes from, and when it is rebuilt."
---

`@soundor/yoga-wasm` (`engines/yoga-wasm`) is what lets the web runtime give a
plugin UI the same boxes as the JUCE runtime: it is the Yoga the engine links,
compiled to WebAssembly. It is versioned on its own, and `@soundor/web-runtime`
depends on an exact version.

## Why not npm's yoga-layout

npm's `yoga-layout` is the same version of Yoga, but not the same layout:

- The engine patches Yoga (`cmake/SoundorYogaPatch.cmake`), and those patches
  change results.
- Its bindings cannot mark a node as text, which rounds differently.
- Its bindings (Emscripten's embind) keep JavaScript functions alive from inside
  WebAssembly, and took about four times as long to build and lay out a tree.

This package calls Yoga's C API directly instead. A node is the integer its
pointer is, freed with `YGNodeFree`, and a measure function is an integer that
one imported function dispatches (`native/shim.cpp`).

## One Yoga

The revision and the patches are the engine's, read from its recipes
(`scripts/inputs.mjs`) and never repeated. So a change to them is a change to
this package too, and both Verify and Release's `validate` fail until it has a
changeset (`scripts/check-release.mjs`): the two would otherwise ship different
layouts. The engine is a dev dependency, which keeps the build order and affected
packages right, but changesets does not release a package for a dev dependency.

Whether they really lay out alike is tested against the engine itself.
`engines/engine/tests/layout/corpus.json` holds generated trees and the frames the
engine gives them, through its `soundor:ui`, the same on every platform. The web runtime's
`layout-corpus.test.ts` has to match them to the last bit. To change the trees, or
after a change that is meant to change layout:

```sh
cd engines/engine
node tests/layout/generate.mjs        # the trees, when they are what changes
cmake --build build/dev --target soundor_runtime_tests
UPDATE_GOLDEN=1 ./build/dev/tests/soundor_runtime_tests --test-suite="layout corpus"
```

## Where the module comes from

Nothing is committed: `generated/` is written by the package's `build`
(`scripts/prepare.mjs`), which takes the first of these that exists for the
fingerprint of its inputs:

1. This machine's cache, under `SOUNDOR_CACHE` or the user cache directory.
2. The latest published package, if it was built from the same inputs. Its
   integrity is checked against npm's.
3. A compile (`scripts/compile.mjs`).

The inputs are Yoga's revision, the engine's patches, `native/shim.cpp`,
`src/exports.ts` and `scripts/compile.mjs` with the flags and the wasi-sdk it pins.
Anything else, the TypeScript bindings or the package's version included, reuses
the module. So you only compile when you change one of those.

A failure to reach npm is an error, not a reason to compile. To work offline, set
`SOUNDOR_YOGA_WASM=source`, which compiles without asking npm.

## In a release

A release trusts no cache ([workflow](/docs/contribute/workflow)), and this module
needs no signed snapshot to be fast: a cold compile, downloads included, takes
well under a minute. So with `SOUNDOR_YOGA_WASM=release`, which Release sets
wherever it builds the module (`validate`, `pack` and the website), a build reads
and writes no cache and takes nothing from npm. It downloads the pinned wasi-sdk and
Yoga into a directory of its own, checks their SHA-256 and compiles.

Two checks then hold it to that:

- If the latest published module has the same inputs, it must be these very bytes,
  or the build fails. The build is reproducible, so a difference means one of them
  is not what its inputs make.
- Before packing, `check-release.mjs --built` requires `dist/build.json` to say it
  was compiled this way, from this checkout's inputs.

An unknown `SOUNDOR_YOGA_WASM` is an error, so a typo in a workflow cannot fall back
to the cache. Verify keeps the ordinary path, as it does for other caches.

## Compiling

A compile needs CMake, for the engine's patch script, and nothing else you have to
install. [wasi-sdk](https://github.com/WebAssembly/wasi-sdk), with its own clang,
`wasm-ld`, libc and libc++, and Yoga's sources are downloaded once into the cache,
at the versions and SHA-256 digests pinned in `scripts/compile.mjs`.

Updating the wasi-sdk means updating its digests in `scripts/compile.mjs`, from the
release's assets, and the notices in `NOTICE.md` and `licenses/`: its `VERSION` file
names the revisions of what is compiled in, and its archive holds no license texts.

## Adding a function

A function of Yoga's C API has to be listed in `src/exports.ts`, so the linker keeps
it, and declared in `YogaApi` in `src/index.ts`. The list is an input, so the next
build compiles. `src/index.test.ts` pins what the module imports: anything new there
means something reached further into libc, whose WASI functions are stubs.
