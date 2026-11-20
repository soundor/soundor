---
title: 'soundor:presets'
description: 'Config-defined factory presets, host programs, and synchronous loading with opt-in undo/redo.'
---

Factory presets are complete snapshots declared in `soundor.config.ts`.
JavaScript, native processing and host program selectors use the same catalog.

## Declare factory presets

```ts
presets: [
  { id: 'init', name: 'Init' },
  {
    id: 'warm',
    name: 'Warm',
    parameters: { gain: 0.75 },
    state: { presetName: 'Warm' },
  },
],
```

`id` is a stable identifier; `name` is a display name. Omitted writable
parameters and persistent-state fields use their config defaults, so each
entry resolves to a complete snapshot. Read-only parameters (processing
outputs such as meters) are excluded. Unknown fields, invalid values, values
off a parameter's step grid, duplicate ids, and oversized snapshots are rejected
before generation. `defineSoundorConfig()` also checks parameter and state value
types when authoring the config.

Presets capture all declared persistent application state, including fields
omitted from an entry. Keep unrelated preferences in a separate service if
loading a preset should not reset them. Files referenced by state are not
embedded or loaded by this API.

## JavaScript

```ts
import { history } from 'soundor:history';
import { presets } from 'soundor:presets';

const factory = presets.factory.list(); // frozen [{ id, name }, ...]
presets.factory.load('warm', { history: { label: 'Load Warm' } });

const selection = presets.getSnapshot();
// { factoryId: 'warm', modified: false }

const unsubscribe = presets.subscribe(() => {
  console.log(presets.getSnapshot());
});

history.undo();
history.redo();
unsubscribe();
```

`load()` is synchronous and returns `void`; an unknown id throws. It uses the
existing parameter and state setters, including host parameter notifications.
It does not invoke project restoration or the application's `stateRestored()`
hook. There is no second parameter/state store.

`getSnapshot()` returns a stable immutable object. `factoryId` is the selected
factory identity, or `null` for custom content. `modified` compares the current
preset-controlled values with that factory snapshot; read-only outputs do not
mark a preset modified. Returning the values to the snapshot clears the flag.

Subscriptions report selection/modified changes, not every parameter change,
and do not call immediately. Unsubscribe when a consumer is destroyed. Native
UI notifications arrive through the normal runtime dispatch; native C++
subscriptions are delivered on the message thread and coalesce between ticks.

## History

Recording is opt-in. One recorded load groups parameters, persistent state,
and selection into one entry. An unrecorded load still applies the complete
snapshot together and invalidates redo if it changes values.

```ts
history.transaction('Load Warm and Adjust Gain', () => {
  presets.factory.load('warm');
  parameters.gain.set(0.8);
});
```

The outer transaction owns the entry and label. Getters see staged values;
observers see the complete committed snapshot. Validation/gesture conflicts
abort the load without partial writes. A failed preset operation poisons an
outer transaction even if its error is caught. Async callbacks are not allowed.
As with other History transactions, several audio-thread parameter atomics
are not guaranteed to change at the same sample.

## React

```tsx
import { Pressable, Text, usePresetSelection, View } from '@soundor/react';
import { presets } from 'soundor:presets';

function FactoryPresets() {
  const selection = usePresetSelection(presets);
  return (
    <View>
      <Text>
        {selection.factoryId ?? 'Custom'}
        {selection.modified ? ' *' : ''}
      </Text>
      {presets.factory.list().map((preset) => (
        <Pressable
          key={preset.id}
          onPress={() => presets.factory.load(preset.id, { history: true })}
        >
          <Text>{preset.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}
```

## The Rust controller

The plugin's [Rust controller](/docs/rust-controller) reaches the same catalog:
it can load a factory preset and read the selection, on the control thread,
with the same History options. Snapshot checks run on the control thread,
never in the audio callback; the processor reads its parameters as usual.

## DAW programs and saved presets

When the catalog is nonempty, the VST3 runtime makes it the root unit's
program list. A host supporting plugin program lists can show their names and
load them, and shows the one the UI, the controller or History selected.
Program order follows config order; preserve it after release where hosts
store program indices.

Host program changes do not create local History entries. They are not sample-accurate MIDI program changes. Host UI presentation varies.

A DAW can save and restore plugin state using its normal preset system,
including VST3 preset files. The Soundor snapshot format is unchanged. Accepted
restoration clears local History and infers the first factory entry matching
the restored content; otherwise the selection is Custom. Host preset filenames
are not assumed to be available to the plugin.

This API does not enumerate a DAW's preset files, generate/install `.vstpreset`
files, or save user presets. Those are separate storage/distribution features.
The Web and simulated runtimes use the same catalog and loading/history semantics.
