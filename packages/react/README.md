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

| Component    | What it is                                                                                                                                                                                                                                                                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `View`       | A box laid out with flexbox (column by default). Takes `style`, `focusable`, event props, `ref` (its `UiNode`).                                                                                                                                                                                                                                                 |
| `Text`       | Text. Strings, numbers and nested `<Text>` become one run; `numberOfLines` limits it. Strings outside `<Text>` are an error.                                                                                                                                                                                                                                    |
| `Image`      | A bundled image: `source={logo}` with `import logo from './logo.png'`. Sized by its pixels unless styled; `resizeMode` in its style.                                                                                                                                                                                                                            |
| `Canvas`     | Pixels code draws: `width`/`height` (the drawing buffer, 300 by 150 by default; changing either clears it), `style`, and `ref` (its `UiNode`): draw with `ref.current.getContext('2d')` (or `'webgl2'`) in an effect. Sized by its buffer unless styled.                                                                                                        |
| `ScrollView` | Content that scrolls by wheel or `ref.current.scrollTo()`. `contentContainerStyle` styles the box inside; `onScroll`.                                                                                                                                                                                                                                           |
| `TextInput`  | A single-line input. `value` + `onChangeText` (controlled) or `defaultValue`; `placeholder`; `onSubmitEditing` on Enter; `onChange` when the text is committed.                                                                                                                                                                                                 |
| `Pressable`  | A view that responds to presses (a click, or Enter/Space while focused): `onPress`, `onLongPress` (held `delayLongPress` ms, 500 by default), `onPressIn`, `onPressOut`, `onHoverIn`, `onHoverOut`, `disabled`. `style` and `children` may be functions of `{ pressed, hovered, focused }`. A button to assistive technology ([Accessibility](#accessibility)). |
| `FocusScope` | A boundary for keyboard focus, with no node of its own: trap, autofocus, restore ([Focus](#focus)).                                                                                                                                                                                                                                                             |
| `Portal`     | Children rendered elsewhere in the view: over everything, or into a `Portal.Host` ([Portals](#portals)).                                                                                                                                                                                                                                                        |
| `Modal`      | An in-view modal layer: portal, input-blocking backdrop, trapped focus, close requests ([Modal](#modal)).                                                                                                                                                                                                                                                       |

Event props (`onPointerDown`, `onClick`, `onContextMenu`, `onKeyDown`,
`onWheel`, `onFocus`, …, and `…Capture` variants) receive `soundor:ui`'s
Web-style events; they capture and bubble as in the DOM. `onContextMenu`
fires when the secondary button goes down, so a UI can open its own menu.

Styles are React Native's: flexbox, spacing shorthands, percentages, CSS
colors, `borderRadius`, `opacity`, and `zIndex` (an integer stacking a node
among its siblings, for drawing and hit testing alike; layout keeps tree
order). `style` takes arrays and falsy entries; `StyleSheet.create()` names
styles with their types.

## Coordinates

Every position is in logical pixels, in one of three spaces:

| Space   | Relative to                        | Where                                                        |
| ------- | ---------------------------------- | ------------------------------------------------------------ |
| Local   | The event's target                 | `event.locationX`, `event.locationY`                         |
| Parent  | The parent's box (scrolling aside) | `node.layout`                                                |
| Surface | The plugin view's top-left corner  | `event.pageX`, `event.pageY`, `node.getBoundingClientRect()` |

`getBoundingClientRect()` is where the node shows, after its ancestors have
scrolled. Device pixels (a Retina scale, a host that zooms the view) are the
renderer's business and never show up in these numbers. There is no window
or screen space: the view is all a plugin UI knows. (`clientX`/`clientY` and
`offsetX`/`offsetY` are the Web names for `pageX`/`pageY` and
`locationX`/`locationY`.)

A tooltip, then, is the trigger's surface box and a portal:

```tsx
function Hint({ label }: { label: string }) {
  const ref = useRef<UiNode>(null);
  const [box, setBox] = useState<LayoutRect | null>(null);
  return (
    <View
      ref={ref}
      onPointerEnter={() => setBox(ref.current!.getBoundingClientRect())}
      onPointerLeave={() => setBox(null)}
    >
      <Text>?</Text>
      {box && (
        <Portal>
          <Text
            style={{
              position: 'absolute',
              left: box.x,
              top: box.y + box.height,
            }}
          >
            {label}
          </Text>
        </Portal>
      )}
    </View>
  );
}
```

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
  of any `overflow` clipping or scrolling, in surface coordinates (`pageX`,
  `getBoundingClientRect()`). Each portal is an entry that fills the view
  and lets the pointer through; a portal opened later stacks above earlier
  ones, so one opened from inside another (a dropdown in a dialog) is on
  top of it. There is one overlay layer, not one per kind of overlay, and it
  is not exported: `<Portal>` is the way in.
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

A custom context menu is `onContextMenu`, the pointer's surface position
and a portal:

```tsx
function Track() {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <View
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ x: event.pageX, y: event.pageY });
      }}
    >
      …
      {menu && (
        <Portal>
          <TrackMenu
            style={{ position: 'absolute', left: menu.x, top: menu.y }}
            onClose={() => setMenu(null)}
          />
        </Portal>
      )}
    </View>
  );
}
```

## Modal

`Modal` is a layer over the whole view that takes its input until it
closes. It is not a window: it is drawn in the plugin's one view, so it
works the same in any host, and in the browser.

```tsx
<Modal
  visible={confirming}
  onRequestClose={() => setConfirming(false)}
  dismissOnBackdropPress
  backdropStyle={{ backgroundColor: 'rgba(0, 0, 0, 0.4)' }}
>
  <View style={{ margin: 'auto', padding: 16, backgroundColor: 'white' }}>
    <Text>Discard changes?</Text>
    <Pressable onPress={discard}>
      <Text>Discard</Text>
    </Pressable>
  </View>
</Modal>
```

It is a `Portal` plus:

- a backdrop over the whole view that blocks the pointer from everything
  below (transparent unless `backdropStyle` says otherwise); its children
  fill the view above it and stay interactive;
- a trapped `FocusScope` with `autoFocus` and `restoreFocus`: focus goes to
  its first focusable child on open, Tab stays inside, and focus returns on
  close;
- close requests: Escape, and with `dismissOnBackdropPress` a press on the
  backdrop itself (not its content), call `onRequestClose`. The modal stays
  until `visible` is `false`: the caller decides.

`visible` defaults to `true`, `dismissOnBackdropPress` to `false`. Modals
stack like portals: a modal opened from a modal is above it and owns focus
until it closes, and a `<Portal>` opened from a modal (a dropdown, a
tooltip) shows above that modal and belongs to its focus trap.

To assistive technology a modal is a modal dialog, named by
`accessibilityLabel`. While it shows, everything else is hidden from it,
except the portals opened from inside it; a modal opened from it takes
over until it closes.

## Accessibility

Every component takes React Native's accessibility props, so a custom-drawn
control can tell screen readers what it is. Soundor owns these semantics:
each runtime presents the same ones to its platform (ARIA in the browser,
the platform's accessibility natively).

```tsx
<Pressable
  accessibilityRole="adjustable"
  accessibilityLabel="Gain"
  accessibilityValue={{ min: -60, max: 12, now: gain, text: `${gain} dB` }}
  accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
  onAccessibilityAction={(event) => {
    if (event.actionName === 'increment') setGain(gain + 0.5);
    if (event.actionName === 'decrement') setGain(gain - 0.5);
  }}
/>
```

| Prop                    | What it says                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accessible`            | `true`: one element, its descendants' text its label. `false`: the element itself is not perceived; its descendants still are.                                                                                                                                                                                    |
| `accessibilityLabel`    | What is read. By default, a text's text, or the text inside a button-like element.                                                                                                                                                                                                                                |
| `accessibilityHint`     | What acting on it does.                                                                                                                                                                                                                                                                                           |
| `accessibilityRole`     | `none`, `text`, `image`, `button`, `link`, `adjustable`, `checkbox`, `switch`, `togglebutton`, `radio`, `radiogroup`, `progressbar`, `search`, `combobox`, `menu`, `menubar`, `menuitem`, `scrollbar`, `spinbutton`, `tab`, `tablist`, `header`, `summary`, `keyboardkey`, `timer`, `toolbar`, `alert`, `dialog`. |
| `accessibilityState`    | `disabled`, `selected`, `checked` (`true`, `false`, `'mixed'`), `busy`, `expanded`.                                                                                                                                                                                                                               |
| `accessibilityValue`    | `min`, `max`, `now` (fractional values are fine) and `text` (`'-3.5 dB'`, read in place of the number).                                                                                                                                                                                                           |
| `accessibilityActions`  | The actions it responds to: `activate`, `increment`, `decrement`, `longpress`, `expand`, `collapse`, `escape`, `setValue`, or custom names with a `label`.                                                                                                                                                        |
| `onAccessibilityAction` | An action asked of this element: `event.actionName`, and `event.value` for `setValue`. `event.preventDefault()` keeps the runtime's own response (a Pressable's press, focusing) from following.                                                                                                                  |

Defaults:

- `View` and `ScrollView` are not elements themselves; what they contain is.
- `Text` is read as its text (nested `<Text>` included, once). Accessibility
  props of a nested `<Text>` have no effect.
- `Image` is decorative unless given a label, a role or `accessible`.
- `TextInput` is a text field with its current text and placeholder.
- `Pressable` is one element, a `button` unless given another role,
  labelled by its text; it offers `activate` (its `onPress`) and, with
  `onLongPress`, `longpress`; `disabled` makes it disabled to assistive
  technology too (unless `accessibilityState.disabled` says otherwise).
- `TextInput` offers `activate` (start editing: keyboard focus), `focus`
  and `setValue` (replace its text, firing `input` and `change`).
- `Modal` is a modal `dialog` (`accessibilityLabel` names it): while it
  shows, only it is perceived, with the portals opened from inside it.
  With `onRequestClose` it offers `escape` (VoiceOver's scrub), which asks it
  to close like Escape does.

Moving a screen reader's cursor does not move keyboard focus; only an
explicit `focus` request does (or activating a text input), and only to a
focusable element.

### Examples

```tsx
// A button: its text is its label; assistive technology's "activate" is onPress.
<Pressable onPress={save}>
  <Text>Save preset</Text>
</Pressable>

// A toggle: a switch with its state.
<Pressable
  accessibilityRole="switch"
  accessibilityLabel="Bypass"
  accessibilityState={{ checked: bypassed }}
  onPress={() => setBypassed(!bypassed)}
/>

// An adjustable gain control. Every input changes the same state through
// one function; the accessibility value is that state, not a copy.
<View
  focusable
  accessibilityRole="adjustable"
  accessibilityLabel="Gain"
  accessibilityValue={{ min: -60, max: 12, now: gain, text: `${gain.toFixed(1)} dB` }}
  accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }, { name: 'setValue' }]}
  onAccessibilityAction={(event) => {
    if (event.actionName === 'increment') change(gain + 0.5);
    if (event.actionName === 'decrement') change(gain - 0.5);
    if (event.actionName === 'setValue') change(Number(event.value));
  }}
  onKeyDown={(event) => {
    if (event.key === 'ArrowUp') change(gain + 0.5);
    if (event.key === 'ArrowDown') change(gain - 0.5);
  }}
  onPointerMove={drag}
/>

// A text input: labelled; its text is read as its value.
<TextInput accessibilityLabel="Preset name" value={name} onChangeText={setName} />

// A modal dialog: only it is read while open; escape asks it to close.
<Modal visible={open} onRequestClose={close} accessibilityLabel="Settings">
  {/* ... */}
</Modal>
```

The `primitives` example has a complete knob (`GainKnob`).

### How it works

Soundor owns a platform-neutral semantic tree. It is built from the view's
nodes and their `accessibility`, by the same rules in every runtime. The
runtime's platform backend then presents it:

| Platform | Backend                                         |
| -------- | ----------------------------------------------- |
| Web      | ARIA on the DOM elements that draw nodes        |
| Windows  | AccessKit (UI Automation)                       |
| Linux    | AccessKit (AT-SPI), x64                         |
| Android  | AccessKit, once a runtime has an Android view   |
| macOS    | Soundor's VoiceOver bridge                      |
| iOS      | Soundor's VoiceOver bridge (no iOS runtime yet) |

- **Not tied to a framework:** the semantics do not come from JUCE, iPlug2
  or Skia. A plugin framework only tells the backend which native view the
  surface is in, and where. A plugin's accessibility code is the same
  whatever framework hosts it.
- **Three trees:** the _render tree_ (nodes, and where they draw: a portal's
  content is under `overlayRoot`), the _keyboard focus structure_
  (`FocusScope`s, which follow React), and the _semantic tree_ (what a
  screen reader perceives) often look alike but differ:
  - a button's text is not an element of its own;
  - a portal opened inside a modal is read inside it, wherever it draws
    (its overlay entry's `accessibilityParent`);
  - a modal hides the rest from the semantic tree while keyboard focus is
    trapped by its own `FocusScope`.

  Closing a modal restores keyboard focus (the `FocusScope`) and the
  accessibility context (the semantic tree) separately.

- **Coordinates:** an element's bounds are the view's logical pixels, like
  `getBoundingClientRect()`. Each backend converts them to its platform's
  screen coordinates itself; there is no screen or window coordinate API.
- **Cost:** nothing is computed until assistive technology is listening.
  After that, each frame sends only the elements that changed.

See the [native runtime's README](../../runtimes/juce-runtime/native/README.md#accessibility)
for the rules in detail and the backends, and its
[Apple bridge notes](../../runtimes/juce-runtime/native/src/a11y/apple/README.md)
for how the macOS and iOS bridges stay safe in a plugin host.

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
