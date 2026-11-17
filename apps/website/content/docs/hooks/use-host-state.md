---
title: useHostState
description: The host's sample rate, name, track and transport, re-rendering the component as they change.
---

```ts
function useHostState(): HostSnapshot;
```

`useHostState()` returns the current [`HostSnapshot`](/docs/api/host#hostsnapshot)
(sample rate, block size, host name, track and transport) and re-renders the
component when it changes.

```tsx
import { Text, useHostState } from '@soundor/react';

function HostStatus() {
  const { hostName, sampleRate, transport } = useHostState();
  return (
    <Text>
      {hostName || 'No host'} · {Math.round(sampleRate)} Hz
      {transport ? ` · ${transport.bpm.toFixed(1)} BPM` : ''}
    </Text>
  );
}
```

- **A new snapshot arrives every frame while the transport plays**, as the
  playhead moves, so every component that uses the hook re-renders then, even
  if it shows only the tempo. Keep such a component small, or follow the
  playhead from `subscribeHostState()` in an effect, drawing without rendering
  again.
- **The snapshot is immutable.** It is the same object until the state changes.
- **The plugin observes the host; it does not control it.** The transport is
  `null` until the native host supplies a position.

## In each runtime

- **JUCE:** captured on the audio thread without locking and delivered on the
  editor's UI tick; fine for display, not for sample-accurate scheduling.
- **Web:** the host page's state; its sample rate and transport come from the
  page.
- **Tests:** [`testHost.set()`](/docs/testing/test-host) changes it, and the
  React entry commits the update synchronously.

It reads [`soundor:host`](/docs/api/host)'s `getHostState()` and
`subscribeHostState()`, which code outside React can use directly.
