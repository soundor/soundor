---
title: 'useHistory'
description: 'Reactive undo/redo availability, labels and stable actions.'
---

`useHistory()` subscribes to the application or processor's
[History](/docs/api/history). It does not configure parameter or
state fields and does not change their value-returning hooks.

```tsx
import { Pressable, Text, View, useHistory } from '@soundor/react';

export function HistoryButtons() {
  const history = useHistory();
  return (
    <View>
      <Pressable disabled={!history.canUndo} onPress={history.undo}>
        <Text>{history.undoLabel ?? 'Undo'}</Text>
      </Pressable>
      <Pressable disabled={!history.canRedo} onPress={history.redo}>
        <Text>{history.redoLabel ?? 'Redo'}</Text>
      </Pressable>
    </View>
  );
}
```

The result contains `canUndo`, `canRedo`, `undoLabel`, `redoLabel`, `undo()`
and `redo()`. Labels are `null` when unavailable. Actions have stable
identities. Commits, undo/redo and restoration update subscribers; polling is
unnecessary. Use explicit `{ history }` options on setters and gesture starts
to choose which interactions are recorded.
