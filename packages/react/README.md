# @soundor/react

React for Soundor plugin UIs: a renderer for the plugin view (`soundor:ui`)
and the components a UI is made of.

```tsx
import { useState } from 'react';
import { render, Pressable, Text, View, useParameter } from '@soundor/react';
import { parameters } from 'soundor:parameters';

function Gain() {
  const gain = useParameter(parameters.gain);
  return (
    <View style={{ padding: 16, gap: 8 }}>
      <Text style={{ fontSize: 18 }}>Gain {gain.toFixed(2)}</Text>
      <Pressable
        onPress={() => parameters.gain.set(0.5)}
        style={({ pressed }) => ({
          padding: 8,
          backgroundColor: pressed ? '#2a5fd0' : '#3a7bfd',
        })}
      >
        <Text style={{ color: 'white' }}>Reset</Text>
      </Pressable>
    </View>
  );
}

render(<Gain />);
```

The UI runs inside the plugin, in Soundor's JavaScript runtime, not in a
browser: there is no DOM. Components follow React Native's.

## Components

| Component    | What it is                                                                                                                                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `View`       | A box laid out with flexbox (column by default). Takes `style`, `focusable`, event props, `ref` (its `UiNode`).                                                                                                                                                                             |
| `Text`       | Text. Strings, numbers and nested `<Text>` become one run; `numberOfLines` limits it. Strings outside `<Text>` are an error.                                                                                                                                                                |
| `Image`      | A bundled image: `source={logo}` with `import logo from './logo.png'`. Sized by its pixels unless styled; `resizeMode` in its style.                                                                                                                                                        |
| `ScrollView` | Content that scrolls by wheel or `ref.current.scrollTo()`. `contentContainerStyle` styles the box inside; `onScroll`.                                                                                                                                                                       |
| `TextInput`  | A single-line input. `value` + `onChangeText` (controlled) or `defaultValue`; `placeholder`; `onSubmitEditing` on Enter; `onChange` when the text is committed.                                                                                                                             |
| `Pressable`  | A view that responds to presses (a click, or Enter/Space while focused): `onPress`, `onLongPress` (held `delayLongPress` ms, 500 by default), `onPressIn`, `onPressOut`, `onHoverIn`, `onHoverOut`, `disabled`. `style` and `children` may be functions of `{ pressed, hovered, focused }`. |

Event props (`onPointerDown`, `onClick`, `onContextMenu`, `onKeyDown`,
`onWheel`, `onFocus`, …, and `…Capture` variants) receive `soundor:ui`'s
Web-style events; they capture and bubble as in the DOM. `onContextMenu`
fires when the secondary button goes down, so a UI can open its own menu.

Pointer events carry positions in logical pixels: `locationX`/`locationY`
relative to the target, `pageX`/`pageY` relative to the plugin view. A node's
`layout` is relative to its parent, and `getBoundingClientRect()` to the view,
where the node shows after scrolling.

Styles are React Native's: flexbox, spacing shorthands, percentages, CSS
colors, `borderRadius`, `opacity`, and `zIndex` (an integer stacking a node
among its siblings, for drawing and hit testing alike; layout keeps tree
order). `style` takes arrays and falsy entries; `StyleSheet.create()` names
styles with their types.

## Portals

`Portal` renders its children elsewhere in the plugin view while they stay
in their component's React tree: context, state and effects are kept. It is
a Soundor extension (not a React Native component), built on the renderer's
own portals, with no ReactDOM and no other window.

```tsx
function Menu({ x, y }: { x: number; y: number }) {
  return (
    <Portal>
      <View style={{ position: 'absolute', left: x, top: y }}>…</View>
    </Portal>
  );
}
```

- `<Portal>` (also `host={null}` or `host={undefined}`) renders into the
  view's overlay layer: above all of the content whatever its `zIndex`, out
  of any `overflow` clipping or scrolling, in view coordinates (`pageX`,
  `getBoundingClientRect()`). Each portal is an entry that fills the view
  and lets the pointer through; a portal opened later stacks above earlier
  ones, so one opened from inside another (a dropdown in a dialog) is on
  top of it. The overlay layer itself is not exported.
- `<Portal host={host}>` renders into the `<Portal.Host host={host}>`, as its
  children: clipped, stacked and scrolled wherever that host is, so it is not
  an overlay unless the host is in one. Hosts are opaque handles from
  `createPortalHost()`. Content waits (renders nothing) until its host
  mounts, goes when the host unmounts, and comes back with it. Showing one
  host in two places at once is an error.

```tsx
const panelHost = createPortalHost();

<View style={{ overflow: 'hidden' }}>
  <Portal.Host host={panelHost} style={{ position: 'absolute', inset: 0, pointerEvents: 'box-none' }} />
</View>

<Portal host={panelHost}>…</Portal>
```

Pointer and key events bubble through the nodes as they are shown: from a
portal's content up to its host (or the overlay layer), not through the
component that declared it. Focus follows React: content a `FocusScope`
renders through a portal belongs to that scope.

## Focus

`FocusScope` groups its children for keyboard focus. It adds no node, so
layout is as if it were not there.

```tsx
<FocusScope trapped autoFocus restoreFocus>
  <TextInput placeholder="Preset name" />
  <Pressable onPress={save}>
    <Text>Save</Text>
  </Pressable>
</FocusScope>
```

- `trapped`: Tab and Shift+Tab cycle through the scope's focusable nodes,
  wrapping at the ends, and focus moved outside comes back. The innermost
  trapping scope wins.
- `autoFocus`: on mount, focuses the first focusable node, unless focus is
  already inside.
- `restoreFocus`: on unmount, gives focus back to the node that had it on
  mount, if that node is still there and focusable.

All default to `false`. Membership follows React, not the node tree: what
the scope's children render belongs to it wherever it shows.

## Rendering

- `render(element)` renders into the whole plugin view.
- `createRoot(node?)` renders into a `soundor:ui` node (default: the view's
  root) and returns `{ render, unmount }`.
- `flushSync(fn)` applies the updates `fn` makes before returning.

## Hooks

- `useParameter(parameters.gain)`: the parameter's value; re-renders when the
  host, the audio side or the UI changes it.
- `useAnimationFrame((time) => …)`: a callback on every frame while mounted.

## License

MIT
