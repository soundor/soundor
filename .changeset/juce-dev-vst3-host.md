---
'@soundor/core': minor
'@soundor/juce-runtime': minor
'@soundor/vst3-host': patch
'create-soundor-app': minor
---

`soundor dev juce` opens the VST3 in `@soundor/vst3-host`, now an optional peer, when the project installs it and `formats` has `vst3`; otherwise the Standalone, as before. `juceRuntime({ dev: { launch } })` chooses (`'vst3'`, `'standalone'` or `false`), and the `v` and `s` keys open either at any time. The plugin's state is kept in `.soundor/state/juce/vst3.json` between launches of the host. New projects with the JUCE runtime get the host as a devDependency. In the host, `launchHost({ detached: true })` runs it in a process group of its own, so that a terminal's Ctrl+C reaches only Node. Runtimes get `ctx.paths.state`, `.soundor/state/<id>`, for what they keep between sessions and cannot make again. A local build of the host no longer needs a static libstdc++ (Fedora's `libstdc++-static`); only the published executables link it.
