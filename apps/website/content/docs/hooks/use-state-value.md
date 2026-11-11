---
title: 'useStateValue'
description: 'Subscribe to one persistent state field in React.'
---

```tsx
import { Text, useStateValue } from '@soundor/react';
import { state } from 'soundor:state';

export function PresetName() {
  const name = useStateValue(state.selectedPreset);
  return <Text>{name ?? 'No preset selected'}</Text>;
}
```

`useStateValue(field)` returns the field's inferred value and subscribes while
the component is mounted. It refreshes on native writes, JavaScript writes and
snapshot restoration, and unsubscribes on cleanup. Equivalent writes keep the
same immutable snapshot, avoiding unnecessary renders. Nullable fields return
`null`, and arrays/structs are deeply frozen. Use the field's `set()` method to
write a replacement value, or pass a synchronous updater such as
`state.bands.set(current => [...current, newBand])`. The updater reads the latest
store value even before React renders again. State setters never open automatic gestures.

A reopened editor reads the processor's current values. See
[`soundor:state`](/docs/api/state) for configuration, native access, persistence,
restoration callbacks, threading and snapshot compatibility. History integration
is a separate future feature; this hook currently takes only the field.
