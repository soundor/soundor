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

| Component    | What it is                                                                                                                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `View`       | A box laid out with flexbox (column by default). Takes `style`, `focusable`, event props, `ref` (its `UiNode`).                                                                                                          |
| `Text`       | Text. Strings, numbers and nested `<Text>` become one run; `numberOfLines` limits it. Strings outside `<Text>` are an error.                                                                                             |
| `Image`      | A bundled image: `source={logo}` with `import logo from './logo.png'`. Sized by its pixels unless styled; `resizeMode` in its style.                                                                                     |
| `ScrollView` | Content that scrolls by wheel or `ref.current.scrollTo()`. `contentContainerStyle` styles the box inside; `onScroll`.                                                                                                    |
| `TextInput`  | A single-line input. `value` + `onChangeText` (controlled) or `defaultValue`; `placeholder`; `onSubmitEditing` on Enter; `onChange` when the text is committed.                                                          |
| `Pressable`  | A view that responds to presses (a click, or Enter/Space while focused): `onPress`, `onPressIn`, `onPressOut`, `onHoverIn`, `onHoverOut`, `disabled`. `style` and `children` may be functions of `{ pressed, hovered }`. |

Event props (`onPointerDown`, `onClick`, `onKeyDown`, `onWheel`, `onFocus`,
…, and `…Capture` variants) receive `soundor:ui`'s Web-style events; they
capture and bubble as in the DOM.

Styles are React Native's: flexbox, spacing shorthands, percentages, CSS
colors, `borderRadius`, `opacity`. `style` takes arrays and falsy entries;
`StyleSheet.create()` names styles with their types.

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
