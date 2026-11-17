---
title: usePresetSelection
description: Which factory preset is selected and whether it was modified, re-rendering the component when either changes.
---

```ts
function usePresetSelection(): PresetSelection;

interface PresetSelection {
  readonly factoryId: string | null; // null for custom or restored content
  readonly modified: boolean; // preset-controlled values differ from the snapshot
}
```

`usePresetSelection()` returns the selection of the config's
[factory presets](/docs/api/presets) and re-renders the component when the
selected preset or whether it was modified changes: a load, an edit of a
value the preset controls, an undo or a restored state.

```tsx
import { Pressable, Text, usePresetSelection, View } from '@soundor/react';
import { presets } from 'soundor:presets';

function FactoryPresets() {
  const { factoryId, modified } = usePresetSelection();
  return (
    <View>
      <Text>
        {factoryId ?? 'Custom'}
        {modified ? ' *' : ''}
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

- **The catalog is static.** Read it with `presets.factory.list()`, and load
  with `presets.factory.load(id)`; neither needs a hook. Pass
  `{ history: true }` to record the load as one undo entry.
- **Equal selections keep one snapshot**, so the component re-renders only
  when `factoryId` or `modified` changed.
- **A plugin without presets** has an empty catalog and a `null` selection.

It reads [`soundor:presets`](/docs/api/presets)'s `getSnapshot()` and
`subscribe()`, which code outside React can use directly.
