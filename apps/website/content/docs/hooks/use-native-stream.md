---
title: useNativeStream
description: The latest value of a native stream, re-rendering the component when a newer one arrives.
---

```ts
function useNativeStream<T>(stream: NativeStreamLike<T>): T | undefined;

interface NativeStreamLike<T> {
  get(): T | undefined;
  subscribe(listener: (value: T, sequence: number) => void): () => void;
}
```

`useNativeStream(streams.peak)` returns the latest value the UI received on a
[`soundor:native` stream](/docs/api/native) (a value native code keeps
publishing, declared under `native.streams`) and re-renders the component when
a newer one arrives. It is `undefined` until native code has published one; a
UI that opens, or reloads, starts with the value published last.

```tsx
import { Text, useNativeStream } from '@soundor/react';
import { streams } from 'soundor:native';

function Peak() {
  const peak = useNativeStream(streams.peak);
  const text = peak === undefined || peak <= -96 ? '-∞' : peak.toFixed(1);
  return <Text>Peak {text} dB</Text>;
}
```

- **At most once a frame.** Values published in between are skipped, and a
  value equal to the one shown does not render again.
- **For a buffer, draw instead of render.** A spectrum arrives as a typed
  array about 60 times a second; React state is the wrong place for it. Draw
  it from `streams.spectrum.subscribe()` in an effect, as the
  [analyzer example](/docs/examples/analyzer) does, and use this hook for
  values the component's markup shows.
- **The value is shared** between this hook, `get()` and every subscriber:
  treat it as read-only.
- **Typed from the config:** a number stream gives a `number`, a
  `buffer<float32>` a `Float32Array`.

It takes anything with `get()` and `subscribe()`, as the streams of
[`soundor:native`](/docs/api/native) have; code outside React uses them
directly.
