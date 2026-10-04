# basic

One Soundor plugin, a gain, built for two runtimes from one config and one UI.

```text
soundor.config.ts   identity, the `gain` parameter, both runtimes
src/main.tsx        the plugin UI (@soundor/react): a fader, the host's
                    transport, a preset name kept in soundor:storage

runtimes/juce/      JUCE (C++): applies `gain` in PluginProcessor.cpp
runtimes/web/       Web (TypeScript): applies `gain` with a GainNode in
                    src/audio.ts
```

The UI is the same in both. Only the audio code is written per runtime, in
each runtime's own language: about ten lines of C++ in
`runtimes/juce/PluginProcessor.cpp`, and about ten of TypeScript in
`runtimes/web/src/audio.ts`:

```ts
export const setupAudio: WebAudioSetup = ({ context, input, output }) => {
  const gain = context.createGain();
  gain.gain.value = parameters.gain.get();
  const unsubscribe = parameters.gain.subscribe((value) =>
    gain.gain.setTargetAtTime(value, context.currentTime, 0.01),
  );
  input.connect(gain);
  gain.connect(output);
  // …
};
```

## In the browser

```sh
pnpm dev:web     # soundor dev web: the host, with an inspector
pnpm build:web   # soundor build web: a static site in .soundor/dist/web
```

Press ▶ to start audio (the host's oscillator, or an audio file of yours)
and move the fader: the plugin UI sets `gain`, and the GainNode follows it.

The build works from any path and inside an iframe, so a docs page can show
the code above next to the running plugin:

```html
<iframe src="examples/basic/" width="840" height="720"></iframe>
```

## As a JUCE plugin

```sh
pnpm exec soundor dev juce     # a debug build, the Standalone launched
pnpm exec soundor build juce   # VST3 and Standalone in .soundor/dist/juce
```

JUCE must be installed (see `soundor doctor`).
