---
'@soundor/web-runtime': minor
---

New `@soundor/web-runtime`: runs a Soundor plugin in the browser, with Vite as its host and build system.

- `webRuntime()` implements the five lifecycle phases. `init` scaffolds a user-owned Web host under `runtimes/web/` and never overwrites a file; it adds no `package.json` or lockfile there. `gen` emits a deterministic manifest (plugin identity and parameters). `dev` serves the host with Vite until stopped. `build` writes a static site with relative URLs to `.soundor/dist/web`. `doctor` checks Node.js, Vite and the scaffold.
- `@soundor/web-runtime/vite` exports `defineWebConfig()` for the host's `vite.config.ts`, and `@soundor/web-runtime/client` exports `startSoundorWebHost()`.
- `soundor:parameters`: one parameter store per page, shared by the plugin UI, the user's Web code and the host. It follows the JUCE runtime's semantics: numbers are clamped and ints rounded, a value of the wrong type is a `TypeError`, listeners hear of changes only, and gestures nest.
- `soundor:host`: the host is "Soundor Web", with its audio format and a transport (play, pause, stop, tempo, time signature, a four-bar loop). Positions and bar starts honor the time signature's denominator, and subscribers get a snapshot every animation frame while it plays. The plugin observes the transport; only the host controls it.
- The plugin UI is the bundle the CLI builds, loaded as it is: Vite never rebundles `src/main.tsx`. Its `soundor:*` imports resolve to the page's host modules, and its image assets are served and emitted under `soundor-assets/`. In `soundor dev`, a new `build-id` reloads the page (a failed build leaves it as it is), and the page's console appears in the terminal. A project without a UI gets an empty viewport.
