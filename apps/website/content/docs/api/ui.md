---
title: soundor:ui
description: The plugin view's node tree, styles, events, canvases and animations.
---

`soundor:ui` is the plugin view itself: a tree of nodes laid out with
flexbox, with DOM-style events. [`@soundor/react`](/docs/components#rendering) renders
into it, so most UIs never import it; reach for it to animate a node, read
the view's size, or build a renderer.

```ts
import { root, createView, createText } from 'soundor:ui';

const knob = createView({ width: 48, height: 48, margin: 8 });
knob.focusable = true;
knob.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowUp') nudge(1);
});
root.style = { flexDirection: 'row', alignItems: 'center', padding: 12 };
root.appendChild(knob);
root.appendChild(createText('Gain', { fontSize: 13 }));
```

A component's `ref` is its node: `ref.current.animate(…)`,
`ref.current.getBoundingClientRect()`.

## Nodes

| Export                         | What it makes                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `root`                         | The view's root node: what the plugin shows.                                     |
| `overlayRoot`                  | A second root over `root` and everything in it, for overlays (React's `Portal`). |
| `createView(style?)`           | A box.                                                                           |
| `createText(text?, style?)`    | A run of text.                                                                   |
| `createImage(source?, style?)` | A bundled image.                                                                 |
| `createTextInput(options?)`    | A single-line input that edits itself.                                           |
| `createSvg(style?)`            | A retained vector scene; only its root participates in layout.                   |
| `createCanvas(style?)`         | A canvas, with a 2D or WebGL 2 context.                                          |

A `UiNode` is an `EventTarget` with a DOM-like tree (`appendChild`,
`insertBefore`, `removeChild`, `parent`, `children`) and:

- `style`, assigned whole or one property at a time
  ([Style](/docs/components/style));
- `layout` (its box in its parent's) and `getBoundingClientRect()` (in the
  view's), in logical pixels ([coordinates](/docs/components/events#coordinates));
- `focusable`, `focused`, `focusVisible` (whether it should show its
  focus: [Focus rings](/docs/components/events#focus-rings)), `focus()`,
  `blur()`, and the `focusvisiblechange` event;
- `debugId`, the name [DevTools](/docs/cli/devtools) shows and
  [Soundor Driver](/docs/driver) finds the node by;
- `accessibility`, what it is to assistive technology;
- `animate(keyframes, options)`, which returns a `UiAnimation`;
- scrolling, for a view whose style scrolls
  ([Overflow](/docs/components/style#overflow)): `scrollTop`, `scrollLeft`,
  `scrollWidth`, `scrollHeight`, `scrollIndicators`, `scrollTo()` and
  `scrollBy()` with `behavior: 'smooth'`, and `scrollIntoView()` on any node
  inside it ([Scrolling from code](/docs/components/scroll-view#scrolling-from-code));
- per kind: `text`; `value`, `placeholder` and the selection; `source`;
  `width`, `height` and `getContext()`.

## Vector scenes

`createSvg(style?)` creates a leaf UI node. Its `setSvgScene(scene)` method
atomically replaces a validated version 1 scene; `setSvgScene(null)` clears
it. The scene contains a viewBox, groups, paths and basic shapes, with
SVG presentation properties kept separate from `Style`. Shapes are not UI
children and have no individual event or accessibility targets.

The [scene protocol](/docs/contribute/engine-reference#retained-svg-scenes)
documents the data format, coordinate systems, validation limits and
geometry caching. It requires engine 0.6.0 or later.

## Animations

`node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 })` runs an
animation of opacity, transforms, or paint colors, natively, without React.
Compose several with `effect(node, keyframes, options)`, `sequence()`,
`parallel()`, `stagger()`, `delay()` and `repeat()`, then run them with
`animate(description)`. A `UiAnimation` has `finished` (a promise),
`playState`, `currentTime`, and `play()`, `pause()`, `resume()`, `cancel()`,
`finish()`.

`setReducedMotion()` and `prefersReducedMotion()` set and read the reduced
motion preference that animations follow.
[`Animated.View`](/docs/components/animated-view) is the React way in; the
[animation contract](/docs/contribute/engine-reference#advanced-animations)
has the details.

## The rest

| Export                                                                                                | What it is                                                                                                   |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `pressable(node, handlers)`                                                                           | Makes a node pressable and focusable (what `Pressable` uses); returns a function that undoes it.             |
| `clipboard`                                                                                           | The system clipboard's text: `readText()`, `writeText(text)`.                                                |
| `focusedNode()`                                                                                       | The node with keyboard focus, or `null`.                                                                     |
| `exitPointerLock()`, `pointerLockNode()`                                                              | End the pointer lock; the node holding it, or `null` ([Pointer lock](/docs/components/events#pointer-lock)). |
| `viewSize()`, `subscribeViewSize(listener)`                                                           | The view's size and its subscription ([The view's size](#the-views-size)).                                   |
| `editorSize()`, `subscribeEditorSize(listener)`                                                       | The editor's size and its subscription ([The editor's size](#the-editors-size)).                             |
| `requestEditorSize(width, height)`                                                                    | Asks for another editor size ([Asking for a size](#asking-for-a-size)).                                      |
| `registerFont(family, source, descriptors?)`                                                          | Makes a bundled font file a face of `family` ([Fonts](/docs/components/text#fonts)).                         |
| `PointerEvent`, `WheelEvent`, `KeyboardEvent`, `FocusEvent`, `InputEvent`, `AccessibilityActionEvent` | The events nodes fire ([Events](/docs/components/events)).                                                   |

`requestAnimationFrame()` is a global, as on the Web: its callback runs once,
before the view's next frame.

## Observing sizes

`ResizeObserver` is a global too, as on the Web, observing nodes: after a
frame's `requestAnimationFrame` callbacks and its layout, before the frame is
drawn, its callback gets an entry for each observed node whose box changed
size since it was last told.

```ts
const observer = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const [{ inlineSize, blockSize }] = entry.devicePixelContentBoxSize;
    entry.target.width = inlineSize; // a canvas's buffer, exactly its box
    entry.target.height = blockSize;
  }
});
observer.observe(canvas, { box: 'device-pixel-content-box' });
```

Give such a canvas a size by its style (or by flexbox): unstyled, its box is
its buffer's size, so resizing the buffer from the callback would resize the
box again. In React, [`useCanvasSize`](/docs/hooks/use-canvas-size) does all
of this.

- **Boxes:** `observe(node, { box })` compares the `'content-box'` (the
  default: inside border and padding), the `'border-box'` (the node's
  `layout` size), or the `'device-pixel-content-box'` (the content box in
  whole device pixels, which changes with the display's scale too). Each entry
  has all three, as `contentBoxSize`, `borderBoxSize` and
  `devicePixelContentBoxSize`, and `contentRect`, the content box with where it
  starts.
- **When:** first on the frame after `observe()`, once the node is laid out
  to more than 0×0; then whenever the observed box's size changes. A move is
  not a change. A node taken out of the tree is told of as 0×0.
- **What a callback resizes** is measured again on the same frame, for nodes
  deeper in the tree than those just told of. A node at the same depth or
  above waits for the next frame, and the error "ResizeObserver loop completed
  with undelivered notifications." is reported, as in browsers.
- **Cost:** a frame where nothing changed costs one comparison, with no node
  measured. `unobserve(node)` and `disconnect()` stop it. An observer and the
  nodes it observes are let go together once nothing else holds them.

## The view's size

```ts
function viewSize(): ViewSize;
function subscribeViewSize(listener: (size: ViewSize) => void): () => void;

interface ViewSize {
  readonly width: number; // logical pixels
  readonly height: number; // logical pixels
  readonly scale: number; // device pixels per logical pixel
  readonly safeArea: LayoutRect; // the part always shown, in logical pixels
}
```

`viewSize()` is the size the view is laid out at, in logical pixels, its
`scale`, the device pixels per logical pixel (the display's density, times
any scaling the host applies), and its `safeArea`. It is the same frozen
object until one of them changes, so it serves as a store's snapshot.

`safeArea` is the part of the view that is always shown whole, relative to
its top-left corner: the whole view, except in a resizable editor with
[`fit: 'cover'`](/docs/cli/config#limits-fit-and-keepaspectratio-windows-the-ui-was-not-made-for)
in a window it was not made for: larger than its maximum, or, scaling, of
another shape than its layout. There the view covers the whole window and
`safeArea` is the part made for (at most the maximum, or the configured
`width`×`height` when it scales) in its middle, fractional where the zoom
makes it so; keep the UI's content in it and decorate the rest.

| Editor                                            | `width`×`height` | `safeArea`                                   |
| ------------------------------------------------- | ---------------- | -------------------------------------------- |
| Lays out again, 1000×700                          | 1000×700         | the whole view                               |
| Lays out again, max 1000×700, `contain`, 1400×700 | 1000×700         | the whole view (bands outside it)            |
| Lays out again, max 1000×700, `cover`, 1400×700   | 1400×700         | `{ x: 200, y: 0, width: 1000, height: 700 }` |
| Scales, 640×480, `contain`, 1000×480              | 640×480          | the whole view (bands outside it)            |
| Scales, 640×480, `cover`, 1000×480                | 1000×480         | `{ x: 180, y: 0, width: 640, height: 480 }`  |
| Scales, 640×480, `cover`, 2000×960                | 1000×480         | `{ x: 180, y: 0, width: 640, height: 480 }`  |

`subscribeViewSize(listener)` calls `listener` with the new size once
whenever it changes: the user resized the editor (or a web host's iframe
changed size), the safe area moved, or the view moved to a display of
another density. Never
for an unchanged size, and never every frame; a listener that throws is
reported and the others are still called. It returns a function that
unsubscribes. In the JUCE runtime the change arrives on the editor's next
tick, before the frame at the new size is laid out and drawn; a reloaded
runtime starts with no subscribers. Before the host has sized the view,
`width` and `height` may be 0.

[`useViewSize()`](/docs/hooks/use-view-size) is the React way in:
`useSyncExternalStore(subscribeViewSize, viewSize)`.

## The editor's size

```ts
function editorSize(): EditorSize;
function subscribeEditorSize(listener: (size: EditorSize) => void): () => void;

interface EditorSize {
  readonly width: number; // the editor's logical pixels, whole
  readonly height: number;
  readonly resizable: boolean; // whether requestEditorSize() can ask for another
}
```

`editorSize()` is the actual size of the editor the view is shown in: the
plugin's window in a DAW or the Standalone, the plugin viewport on the web
host's page (the page itself in `?embed`). Its units are the editor's
logical pixels, before display density: in an editor that lays out again
they are the view's, and its size is `viewSize()`'s; in one that scales the
view is drawn at a zoom, so the editor is the view times that zoom, bands
included with `fit: 'contain'`. It is the same frozen object until it
changes; before the host shows the editor it is 0×0.

`resizable` says whether [`requestEditorSize()`](#asking-for-a-size) can ask
for another size: true for a resizable editor whose limits allow one, in a
DAW, the Standalone and the web host's page; false for a fixed editor, and
in `?embed`, whose page owns the size. A grip the UI draws hides where it is
false.

`subscribeEditorSize(listener)` calls `listener` with the new size once
whenever it changes, whoever resized the editor: the user, the DAW, or the
web page, or a request. Never for an unchanged size; a listener that throws is reported
and the others are still called. It returns a function that unsubscribes.
In React, `useSyncExternalStore(subscribeEditorSize, editorSize)` reads it.

### Asking for a size

```ts
function requestEditorSize(
  width: number,
  height: number,
): { readonly width: number; readonly height: number } | null;
```

`requestEditorSize(width, height)` asks for the editor to be
`width`×`height`, in the editor's logical pixels (`editorSize()`'s units,
not the layout's of an editor that scales), each rounded to a whole pixel.
Any finite size can be asked for, 0 or less too (a grip dragged far past
the editor's corner): the limits hold it. A side that is not a number
throws a `TypeError`, one that is not finite a `RangeError`, in every
runtime: `requestEditorSize(): width must be a finite number, got NaN`.

The size is held to the editor's
[limits](/docs/cli/config#limits-fit-and-keepaspectratio-windows-the-ui-was-not-made-for),
all of them, though a host resizing the editor itself is held only to its
minimum:

- each side within its minimum and maximum, or
- for an editor that scales keeping its aspect ratio, its configured size
  times one zoom: the size at its ratio nearest to the one asked for (where
  a dragged corner is, as near as it can be), within the zooms the limits
  allow, then rounded. Asking for one side only changes both, by less: at
  800×600, 1000×600 gives 928×696. The answer depends on the size asked for
  only, never on the editor's current size, so a drag asking from where it
  began resizes one way;
- on the web host's page, also no larger than the room the page has,
  unless it is already: the rules its own resize handle keeps;
- in a plugin, also within a minimum or maximum of the host's own that it
  showed: a host that gives another size soon after one was asked for
  (Ardour's window is no narrower than its toolbar, so it sets the editor
  back to the window's width) is not asked for less, or more, again, so a
  grip dragged past it stops there rather than springing back at every
  step. The first time still springs back. The host resizing the editor
  itself beyond what it showed forgets it.

It returns that size, the one asked of the host, frozen, or `null` where
none can be asked for (`editorSize().resizable` is false: a fixed editor,
limits that allow one size, the web host's `?embed`). It is not the new
size: the editor resizes after the calling code returns (in the JUCE
runtime, once the event or the tick that ran it is done; on the web, with
the page's next render), to what the host gives. The JUCE editor asks its
host with `setSize()`, which a VST3 host hears as `resizeView()`, AU and the
Standalone's window as their own; a host may give another size, or keep the
one it has. `subscribeEditorSize()` tells of the size it got, and
`editorSize()` is the old one until then. Asking for the size the editor
has changes nothing; of requests made before the editor resizes, the latest
wins.

### A resize grip

A grip the UI draws itself, in the corner of its view, is a node whose
pointer and key events call `requestEditorSize()`. Its drag measures with
`screenX` and `screenY`, which are the pointer on the screen in the
editor's pixels: unlike `clientX`/`clientY`, they do not move when the
editor resizes or, scaling, zooms. The size it asks for is the size at the
press plus how far the pointer went since, so nothing drifts:

```tsx
const editor = useSyncExternalStore(subscribeEditorSize, editorSize);
const drag = useRef<{ x: number; y: number; width: number; height: number }>();
if (!editor.resizable) return null;
return (
  <View
    focusable
    accessibilityRole="button"
    accessibilityLabel="Resize the editor"
    style={{
      position: 'absolute',
      right: 0,
      bottom: 0,
      width: 18,
      height: 18,
      cursor: 'nwse-resize',
    }}
    onPointerDown={(event) => {
      drag.current = { x: event.screenX, y: event.screenY, ...editor };
    }}
    onPointerMove={(event) => {
      const from = drag.current;
      if (from)
        requestEditorSize(
          from.width + event.screenX - from.x,
          from.height + event.screenY - from.y,
        );
    }}
    onPointerUp={() => (drag.current = undefined)}
  >
    {/* Its look: an <Svg>, or anything else. */}
  </View>
);
```

The pressed node keeps the pointer's events until the release, also where
the pointer leaves it. The examples' `ResizeGrip.tsx`
([Basic](/docs/examples/basic), [Orbit](/docs/examples/orbit)) is the
whole grip: a cancelled drag going back to its first size, the arrow keys,
and its look an `<Svg>` to replace with any other.

Where the corner is depends on the editor's
[`fit`](/docs/cli/config#limits-fit-and-keepaspectratio-windows-the-ui-was-not-made-for).
A host may make the window larger than the editor's maximum, or of another
shape than an editor that scales, whatever it was asked. With `fit:
'contain'` the view stays at the size it was made for, centred in bands,
and a grip in its corner is in the middle of the window. With `fit:
'cover'` the view covers the window, so a grip in its corner, outside the
[safe area](#the-views-size), is the window's corner: the fit for a UI with
a grip of its own.

On the web host's demo page the editor stays centred as it resizes, so its
corner moves half as far as the pointer; in a DAW its top-left corner
stays where it is and the corner follows the pointer.

The [`soundor:ui` reference](/docs/contribute/engine-reference#soundorui)
describes how the native runtime implements it.
