# basic

[Documentation](README.md) · [The idea](overview.md) · [Getting started](getting-started.md) · [Architecture](architecture.md)

Source: [`examples/basic/`](../examples/basic/).

Run this page’s package-local commands from `examples/basic/`, unless noted otherwise.

**On this page**

- [In the browser](#in-the-browser)
- [As a JUCE plugin](#as-a-juce-plugin)
- [Tests](#tests)

One Soundor plugin, a gain, built for two runtimes from one config and one UI.

```text
soundor.config.ts   identity, the `gain` parameter, both runtimes
src/main.tsx        mounts src/App.tsx
src/App.tsx         the plugin UI (@soundor/react): a fader, the host's
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

## Tests

```sh
pnpm test
pnpm typecheck
pnpm build:web
```

Behavioral tests render the real `App` with `@soundor/testing-library/react`,
semantic queries, and `userEvent.setup()`. The four testing dependencies are
explicitly declared. These run against the simulated runtime, with no browser or
native engine. See the [Testing guide](testing.md). Root repository
checks exclude examples; run these commands explicitly.

---

Previous: [Testing Soundor](testing.md) · Next: [primitives](example-primitives.md)
