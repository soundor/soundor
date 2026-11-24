---
'soundor': minor
'@soundor/config': minor
'@soundor/core': minor
'@soundor/runtime-sdk': minor
'@soundor/vst3-runtime': minor
'@soundor/web-runtime': minor
'@soundor/engine': minor
---

Every build now ships the third-party notices of what it contains, in a `licenses/` folder beside the plugin: the VST3 bundle's `Contents/Resources/licenses/` and the web build's `licenses/`, which the web host's panel links to. Besides the engine's and the VST3 SDK's notices, which the VST3 bundle already carried, it holds those of the npm packages in the UI bundle and on the web host page, the Rust crates the plugin links, Rust's standard library, and the project's own files that come with a license. Each component has a folder with its license files, `THIRD-PARTY-NOTICES.txt` has all of them in one file, and `licenses.json` lists them for tools. In the VST3 bundle, `licenses/soundor-engine/` is now `licenses/engine/` and `licenses/vst3sdk/` is `licenses/vst3-sdk/`.

Soundor finds the notices from the build itself. A package file takes the license files nearest to it in its package, so a font next to its `OFL.txt` gets the OFL. Crates are the ones Cargo resolves for the build's target. A build fails when a component has no license text, naming it. The new `licenses` config option adds notices for what the build cannot see and replaces or drops the notice of a package or crate. `soundor licenses` lists what each runtime's build would ship, without building.

Runtimes get an optional `licenses` phase, `LibraryBuildContext.notices()`, and the notices helpers in `@soundor/runtime-sdk`. The UI bundle writes `modules.json`, the files it kept after tree shaking. The engine's web artifact has `licenses`, and its WebAssembly archive carries Emscripten's and musl's notices too. The CLI's Rust SDK and the VST3 runtime's `soundor-vst3` crate ship a `LICENSE`.
