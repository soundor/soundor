---
title: '@soundor/react'
description: Rendering a plugin UI, its hooks and its styles.
---

`@soundor/react` is a React renderer for the plugin view (`soundor:ui`) and
the [components](/docs/components) a UI is made of.

```tsx
import { render } from '@soundor/react';

import { App } from './App';

render(<App />);
```

## Rendering

- **`render(element)`** renders into the whole plugin view, replacing what it
  showed, and returns its root. A plugin's `src/main.tsx` calls it once.
- **`createRoot(node?)`** makes a root that renders into a `soundor:ui` node
  (by default the view's root): `{ render(element), unmount() }`.
- **`flushSync(fn)`** runs `fn` and applies the updates it schedules before
  returning, for code that needs the nodes to be there at once.

## Hooks

- **`useParameter(parameters.gain)`**: the parameter's value. It re-renders
  when the value changes, whoever changed it: the host's automation, a
  preset, the audio side, or the UI. See
  [`soundor:parameters`](/docs/api/parameters).
- **`useAnimationFrame((time) => …)`**: calls the callback before every frame
  while the component is mounted, with the frame's time in milliseconds. It
  always calls the latest callback, so it may read props and state. Draw a
  [`Canvas`](/docs/components/canvas) with it.

## Styles

- **`StyleSheet.create(styles)`** names styles once, typed, and returns them
  as they are.
- **`StyleSheet.flatten(style)`** (also `flattenStyle`) merges a style prop
  (an array, falsy entries) into one object.
- The types `Style` and `StyleProp`. See [Style](/docs/components/style).

## Portals

- **`createPortalHost()`** makes the handle a `<Portal.Host>` shows and
  `<Portal host>` renders into. See [Portal](/docs/components/portal#into-a-host).

## Testing

`@soundor/testing-library/react` renders with this renderer against a
simulated runtime: see the [Testing guide](/docs/testing) and
[`@soundor/testing-library`](/docs/api/testing-library).
