---
'@soundor/web-runtime': minor
---

New `@soundor/web-runtime`: runs a Soundor plugin in the browser, with Vite as its host and build system.

- `webRuntime()` implements the five lifecycle phases. `init` scaffolds a user-owned Web host under `runtimes/web/` and never overwrites a file; it adds no `package.json` or lockfile there. `gen` emits a deterministic manifest (plugin identity and parameters). `dev` serves the host with Vite until stopped. `build` writes a static site with relative URLs to `.soundor/dist/web`. `doctor` checks Node.js, Vite and the scaffold.
- `@soundor/web-runtime/vite` exports `defineWebConfig()` for the host's `vite.config.ts`, and `@soundor/web-runtime/client` exports `startSoundorWebHost()`.
