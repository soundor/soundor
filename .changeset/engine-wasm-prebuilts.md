---
'@soundor/engine': minor
---

The WebAssembly core is part of the engine's prebuilt release: `soundor-engine-<version>-web-release.tar.gz`, with `soundor-core.wasm`, its metadata and license notices, beside the native archives, and named in `artifacts/manifest.json` with its own input fingerprint and protocol version. A release cannot be published without it.

`@soundor/engine` has a Node API, `engine({ target, mode })`, for build tooling: `target` is `web`, `linux-x64`, `windows-x64` or `macos-universal` (with a native `variant`), `mode` is `prebuilt` (the default), `published` or `source`. It downloads the version's published artifact once into the Soundor cache (shared with CMake's prebuilt mode), verifies it and returns absolute paths: the module for `web`, headers, libraries and link flags for a native target. In the engine's source checkout it uses the release only while the sources match, and builds them otherwise. Download, checksum and manifest failures are errors, never a reason to build. `pnpm build:wasm` is its source mode, and stages the module as the release archive holds it.

The module exports its protocol version (`soundor_engine_protocol`), which `@soundor/engine/web` checks before using it: a module of another engine version fails with what to do.
