---
title: 'soundor:state'
description: 'Typed application data persisted independently of the plugin editor.'
---

Declared state is application data, such as a preset name or a list of bands.
[Parameters](/docs/api/parameters) represent values shared with host automation;
state has no host parameter ID, normalized range or implicit smoothing. State
gestures describe editing lifecycles only.

## Declare state

```ts
import { defineSoundorConfig } from '@soundor/config';

export default defineSoundorConfig({
  plugin: { id: 'com.acme.equalizer', name: 'Equalizer' },
  runtimes: [], // add your runtime factories
  native: {
    types: {
      Band: { struct: { frequency: 'float32', gain: 'float32', q: 'float32' } },
    },
  },
  state: {
    selectedPreset: { type: 'string?', default: null },
    enabled: { type: 'boolean', default: true },
    bands: { type: 'Band[]', default: [] },
  },
});
```

State uses the same type registry as [the native API](/docs/api/native):
`boolean`, `string`, `int8`/`uint8` through `int64`/`uint64`, `float32`,
`float64`, named structs and enums, arrays (`T[]`), and nullable values
(`T?`). Structs may contain other structs and arrays. Recursive structs,
`void`, and binary `buffer<T>` state are unsupported. Nullable means `null`,
never `undefined`. Every field requires a default; Soundor checks nested
values and numeric widths when generating the plugin, as well as at runtime.
64-bit integers are JavaScript `bigint`s. Float32 values round to their native
precision. Floats must be finite. Strings must be valid Unicode without NUL.
Each processor/application initializes its own copy of mutable defaults.

A field's name is its persistent identity. Keep it stable after releasing a
plugin. Names used by the state infrastructure, including `onRestored`, are
reserved and rejected during validation.

## JavaScript

```ts
import { state } from 'soundor:state';

state.selectedPreset.get(); // string | null
state.selectedPreset.set('Warm Vocal');
state.bands.set((current) => [
  ...current,
  { frequency: 1000, gain: -3, q: 1.2 },
]);

const stop = state.selectedPreset.subscribe((value) => console.log(value));
const stopRestored = state.onRestored(() =>
  console.log(state.selectedPreset.get()),
);
// On cleanup:
stop();
stopRestored();
```

Reads and writes are synchronous. Writes copy and validate their input.
Read values are deeply frozen; repeated reads return the same object until
its value changes. Replace arrays and structs with `set()` to change them.
Equality is structural: struct fields and array elements are compared by
value, arrays in order. Writing an equivalent value does not notify.

Subscriptions receive changed field values and return an unsubscribe function.
In JUCE, notifications from both JavaScript and native writes are queued in
write order and delivered on the editor's next message-thread tick, like
parameter notifications. Web writes notify synchronously. Subscriber exceptions
are reported without preventing other subscribers from running.

Restoration installs every state field before delivering field notifications;
`onRestored` follows those notifications, including when all values were equal.
Reads always return the current store, which may include subsequent writes.
No event is replayed for an editor opened after restoration: its initial reads
already return the saved values. Restoration never creates an editor or starts
Hermes. Initial Web hydration completes before application modules run; read
initial values normally rather than waiting for an initial restoration event.

In React, use [`useStateValue`](/docs/hooks/use-state-value):

```tsx
import { Text, useStateValue } from '@soundor/react';
import { state } from 'soundor:state';

export function PresetName() {
  const name = useStateValue(state.selectedPreset);
  return <Text>{name ?? 'No preset selected'}</Text>;
}
```

## Editing gestures

Gestures are optional. `set()` works normally without them. Use a gesture to
mark a continuous user interaction, such as dragging an EQ band:

```ts
state.bands.beginGesture();
try {
  state.bands.set(updatedBands);
} finally {
  state.bands.endGesture();
}
```

Writes apply immediately and retain their usual notifications and persistence.
Gestures do not buffer writes or create History entries. A gesture describes the
lifetime of a user interaction; it does not decide whether it is undoable.

|                           | Parameter gesture    | State gesture |
| ------------------------- | -------------------- | ------------- |
| Defines editing lifecycle | Yes                  | Yes           |
| Updates immediately       | Yes                  | Yes           |
| DAW automation gesture    | Yes, where supported | No            |
| Creates History entry     | Not yet              | Not yet       |
| Future History grouping   | Yes                  | Yes           |

Nested begins form one logical interaction: only the first begin and final end
are outer boundaries. Each field has its own lifecycle. Extra or unmatched ends
are ignored, and gestures containing no writes are valid. Closing or reloading
the editor clears that UI session's unfinished gestures without changing state.
Native processor gestures survive editor closure. Restoration clears all active
gestures before notifying state subscribers, without replaying gesture boundaries.
Gesture metadata is never saved. Cleanup of an older editor cannot close a new
editor's gesture after restoration.

`useStateValue(state.bands)` still returns the value. React event handlers can
call `state.bands.beginGesture()`, `set()` and `endGesture()` directly. No History
options, transactions or rollback are provided yet.

## Native JUCE code

The generated `soundor::AudioProcessor` base owns `state`. It survives closing
the editor, and two processors have independent stores:

```cpp
void MyProcessor::selectPreset()
{
    state.selectedPreset.set(std::optional<std::string>{"Warm Vocal"});
    auto bands = state.bands.get();
    bands.push_back(soundor::native::Band{1000.0f, -3.0f, 1.2f});
    state.bands.set(std::move(bands));
}
```

Types reuse `soundor::native`: `bool`, sized integers, `float`/`double`,
`std::string`, `std::optional<T>`, `std::vector<T>` and generated structs/enums.
Native fields also expose `beginGesture()` and `endGesture()`. Native and
JavaScript calls contribute to the same processor-owned field lifecycle; each
caller balances its own begins and ends. Native getters return independent
copies. Setters reject invalid values.
A native field also has `subscribe(std::function<void(T)>)`, returning an
unsubscribe closure. Native subscribers run synchronously on the writing
thread; unsubscribe before destroying the processor.

**State access is control-thread work, never real-time safe.** It allocates and
uses synchronization. Do not read, write, subscribe or begin/end gestures in
`process()`. Maintain your own real-time-safe derived DSP representation and publish it with your
usual control-to-audio mechanism. Ordinary parameter handles retain their
existing real-time-safe reads.

## Saving and restoration

Soundor owns `getStateInformation()` and `setStateInformation()`; do not override
them to persist declared state. JUCE saves parameters and state as one logical
snapshot associated with the DAW's plugin slot. A duplicated track gets an
independent processor with copied values. No processor UUID is serialized.

Soundor validates the complete snapshot before changing any value. On the JUCE
message thread it then replaces APVTS parameters, replaces state, queues field
and restoration notifications, and calls this protected native extension point:

```cpp
void MyProcessor::stateRestored()
{
    // All saved values are available here, even with no editor.
    rebuildDerivedState();
    bandHistory.stateReplaced(); // your application's own history, if any
}
```

`stateRestored()` fires once for each successful complete host restoration,
including a valid legacy project, and never for saving, construction, rejected
data or ordinary writes. It always runs on the JUCE message thread. When a host
calls `setStateInformation()` on that thread, completion is synchronous. Calls
from other threads validate and queue the **whole restoration** to the message
thread and return before applying it. Queued operations apply in order, each
followed by its hook. Up to eight off-thread restorations may wait for dispatch;
excess requests are rejected and logged. Until dispatch, audio observes the previous parameter
values. A host must service the JUCE message loop. Destruction cancels pending
work; as with JUCE's other message-thread objects, destroy a processor on the
message thread or while holding the message-manager lock. Never put this
restoration path in the audio callback.

Parameters can still change through host automation during a save or restore;
JUCE does not provide atomic visibility across multiple host parameters.
Soundor does not add locks to parameter processing or the audio callback.

## Web standalone persistence

The Web runtime uses one application context and one parameter/state store.
It hydrates from IndexedDB before loading native/audio/UI application modules,
then debounces automatic saves by 100 ms. UI bundle reloads retain the host
context. Browser reloads and application restarts hydrate the saved snapshot.
IndexedDB is namespaced by the config's stable `plugin.id` and browser origin;
unrelated applications should use different IDs. Storage errors are reported
while live in-memory values remain usable. A browser that denies storage starts
from defaults. Very recent writes can be lost if the browser terminates before
a debounced save completes.

The object returned by `startSoundorWebHost()` exposes `reset()` to restore and
save both parameter and state defaults. `dispose()` requests a final save.
Applications do not need multi-instance management or persistent instance IDs.

## Snapshot compatibility

Version 1 is UTF-8 JSON with `version`, `parameters` and `state`. Parameters use
plain numbers, booleans and choice strings. State follows its declared shape;
64-bit integers use canonical decimal strings on the wire to retain every bit.
Null remains null. Save output uses stable generated field order and native
precision. Whitespace and object property order have no semantic meaning.

Missing fields use their declared defaults. Unknown parameter/state fields are
ignored, allowing removed fields; renaming a field therefore creates a new field
with its default. Changing a field's type or a struct's shape may reject old
snapshots. Invalid known values, malformed data, unsupported versions and unknown
snapshot envelope fields reject the complete operation and are reported. The
previous live values remain intact. No automatic migration silently coerces
incompatible data. Existing JUCE `SOUNDOR` APVTS XML snapshots remain readable;
new saves use version 1.

Snapshots are limited to 8 MiB, nesting to 64 levels and collection sizes to
100,000 elements. Keep application state modest; use file APIs for large assets.
Saving does not invoke restoration callbacks.

All mutations go through the store's setter/replacement path. History,
transactions and undo/redo are separate future features;
no `history` hook option exists in this API.

## Functional setters

A JavaScript field's `set()` accepts a direct value or a synchronous updater:

```ts
state.counter.set((current) => current + 1);
state.bands.set((current) => [...current, newBand]);
```

The updater runs once against the latest immutable store value, rather than the
value captured by a React render. Sequential calls see each preceding write,
and `get()` reflects a successful write immediately. Returned arrays and structs
are validated, detached and deeply frozen. Equivalent values do not notify.
Exceptions propagate without committing a value; async callbacks, thenables and
invalid results are rejected. The native C++ setter continues taking a value.

State setters create no automatic gesture. State gestures remain optional,
explicit Soundor editing boundaries and never automate the JUCE host. Subscription,
saving and restoration behavior is the same for direct and functional updates.

## Undo and redo

Pass `{ history: true }` to a setter for one undo entry, or
`{ history: { label: 'Edit' } }` to `beginGesture()` to group a continuous edit.
[History](/docs/api/history) also provides synchronous buffered
transactions across parameters and state. Recording remains opt-in.
