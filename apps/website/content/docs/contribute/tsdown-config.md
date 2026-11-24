---
title: 'Shared tsdown config'
description: 'Workspace-only build presets.'
---

Source: [`configs/tsdown-config/`](https://github.com/soundor/soundor/tree/main/configs/tsdown-config).

Workspace-only shared `tsdown` presets for Soundor packages.

## Usage

This package is private to the Soundor monorepo and is not published to npm.
Soundor packages import it from the pnpm workspace during development and CI.

## Third-party notices

A published package whose `dist` inlines npm packages ships their notices
with it. `thirdPartyNotices({ title })` is a rolldown plugin, for tsdown and
Vite alike, that writes them into `dist/licenses/`, in the layout plugin
builds use: `THIRD-PARTY-NOTICES.txt`, `licenses.json`, and each package's
license files in `javascript/<name>@<version>/`. Only what tree shaking kept
counts, and only packages from `node_modules`; this repository's own are
under its license, which every published package carries. A bundled package
without a license file fails the build.

It is used by the engine's lowering (`@soundor/engine/native-module`, which
inlines Babel) and the DevTools dashboard (`@soundor/devtools-client`, which
inlines React). A package that starts inlining a dependency uses it too.

## License

MIT
