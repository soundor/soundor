---
title: 'testHost'
description: 'Sets what the host reports in a test: its name, sample rate, transport.'
---

```ts
testHost.set(state: Partial<HostSnapshot>): void;
```

Merges `state` into the host's snapshot (`soundor:host`) and tells its
subscribers: a test's DAW name, sample rate, block size or transport.

```ts
testHost.set({ hostName: 'Test DAW', sampleRate: 96000 });
expect(screen.getByText(/Test DAW · 96000 Hz/)).toBeDefined();

testHost.set({
  transport: {
    playing: true,
    recording: false,
    looping: false,
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    ppqPosition: 8,
    barStartPpq: 8,
    timeInSeconds: 4,
    timeInSamples: 192000,
  },
});
```

## Good to know

- **`transport` is whole,** or `null` (no transport): give every field.
- **Initial values** for every test come from the plugin's options:
  `soundor({ runtime: { host: { sampleRate: 96000 } } })`
  ([`soundor()`](/docs/testing/vitest)).
