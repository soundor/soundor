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
| `createScrollView(style?)`     | A box whose children scroll.                                                     |
| `createTextInput(options?)`    | A single-line input that edits itself.                                           |
| `createSvg(style?)`            | A retained vector scene; only its root participates in layout.                   |
| `createCanvas(style?)`         | A canvas, with a 2D or WebGL 2 context.                                          |

A `UiNode` is an `EventTarget` with a DOM-like tree (`appendChild`,
`insertBefore`, `removeChild`, `parent`, `children`) and:

- `style`, assigned whole or one property at a time
  ([Style](/docs/components/style));
- `layout` (its box in its parent's) and `getBoundingClientRect()` (in the
  view's), in logical pixels ([coordinates](/docs/components/events#coordinates));
- `focusable`, `focus()`, `blur()`;
- `debugId`, the name [DevTools](/docs/cli/devtools) shows and
  [Soundor Driver](/docs/driver) finds the node by;
- `accessibility`, what it is to assistive technology;
- `animate(keyframes, options)`, which returns a `UiAnimation`;
- per kind: `text`; `value`, `placeholder` and the selection; `source`;
  `width`, `height` and `getContext()`; `scrollTop`, `scrollLeft`,
  `scrollTo()` and `scrollBy()`.

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
| `registerFont(family, source, descriptors?)`                                                          | Makes a bundled font file a face of `family` ([Fonts](/docs/components/text#fonts)).                         |
| `PointerEvent`, `WheelEvent`, `KeyboardEvent`, `FocusEvent`, `InputEvent`, `AccessibilityActionEvent` | The events nodes fire ([Events](/docs/components/events)).                                                   |

`requestAnimationFrame()` is a global, as on the Web: its callback runs once,
before the view's next frame.

## The view's size

```ts
function viewSize(): ViewSize;
function subscribeViewSize(listener: (size: ViewSize) => void): () => void;

interface ViewSize {
  readonly width: number; // logical pixels
  readonly height: number; // logical pixels
  readonly scale: number; // device pixels per logical pixel
}
```

`viewSize()` is the size the view is laid out at, in logical pixels, and
its `scale`, the device pixels per logical pixel (the display's density,
times any scaling the host applies). It is the same frozen object until one
of them changes, so it serves as a store's snapshot.

`subscribeViewSize(listener)` calls `listener` with the new size once
whenever it changes: the user resized the editor (or a web host's iframe
changed size), or the view moved to a display of another density. Never
for an unchanged size, and never every frame; a listener that throws is
reported and the others are still called. It returns a function that
unsubscribes. In the JUCE runtime the change arrives on the editor's next
tick, before the frame at the new size is laid out and drawn; a reloaded
runtime starts with no subscribers. Before the host has sized the view,
`width` and `height` may be 0.

[`useViewSize()`](/docs/hooks/use-view-size) is the React way in:
`useSyncExternalStore(subscribeViewSize, viewSize)`.

The [`soundor:ui` reference](/docs/contribute/engine-reference#soundorui)
describes how the native runtime implements it.
