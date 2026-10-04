---
'@soundor/web-runtime': minor
---

The Web host implements `soundor:native` in TypeScript and gains Web Audio and a host UI.

- `gen` emits `native.ts`, a `WebNativeApi` interface generated from the config's native API (primitives, binary types, arrays, structs, enums, handles, sync and async methods). A method added to the config is a type error in `runtimes/web/src/native.ts` until it is implemented. `soundor:native` calls that implementation directly: the same values, exceptions and promises, with no serialization. Handles are opaque objects made with each handle type's `wrap()`, and they cannot be forged.
- `init` also scaffolds `src/native.ts` and `src/audio.ts`. `startSoundorWebHost({ native, audio })` loads them after the host exists.
- The host owns one `AudioContext`, created from the user's first Play as browsers require. Its graph is source → input → the project's `setupAudio({ context, input, output })` → output → master volume. A missing or failing setup passes the input through. Sources are an oscillator, an audio file or none, and they play while the transport does. The transport follows the audio clock and reports the context's sample rate.
- The host UI: play/pause, stop, loop, tempo, time signature, position, source, volume and mute, and the sample rate in the status bar. A plugin view too big for the page is scaled to fit, which helps in iframes. `soundor dev` adds an inspector of the host state and the parameters; builds show the clean demo.
