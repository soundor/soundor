---
title: soundor:ui
description: The plugin view's node tree, styles, events, canvases and animations.
---

`soundor:ui` is the plugin view itself: a tree of nodes laid out with
flexbox, with DOM-style events. [`@soundor/react`](/docs/api/react) renders
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
| `createCanvas(style?)`         | A canvas, with a 2D or WebGL 2 context.                                          |

A `UiNode` is an `EventTarget` with a DOM-like tree (`appendChild`,
`insertBefore`, `removeChild`, `parent`, `children`) and:

- `style`, assigned whole or one property at a time
  ([Style](/docs/components/style));
- `layout` (its box in its parent's) and `getBoundingClientRect()` (in the
  view's), in logical pixels ([coordinates](/docs/components/events#coordinates));
- `focusable`, `focus()`, `blur()`;
- `accessibility`, what it is to assistive technology;
- `animate(keyframes, options)`, which returns a `UiAnimation`;
- per kind: `text`; `value`, `placeholder` and the selection; `source`;
  `width`, `height` and `getContext()`; `scrollTop`, `scrollLeft`,
  `scrollTo()` and `scrollBy()`.

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

| Export                                                                                                | What it is                                                                                           |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pressable(node, handlers)`                                                                           | Makes a node pressable and focusable (what `Pressable` uses); returns a function that undoes it.     |
| `clipboard`                                                                                           | The system clipboard's text: `readText()`, `writeText(text)`.                                        |
| `focusedNode()`                                                                                       | The node with keyboard focus, or `null`.                                                             |
| `viewSize()`                                                                                          | The view's `{ width, height }` in logical pixels, and its `scale` (device pixels per logical pixel). |
| `PointerEvent`, `WheelEvent`, `KeyboardEvent`, `FocusEvent`, `InputEvent`, `AccessibilityActionEvent` | The events nodes fire ([Events](/docs/components/events)).                                           |

`requestAnimationFrame()` is a global, as on the Web: its callback runs once,
before the view's next frame.

The [`soundor:ui` reference](/docs/contribute/engine-reference#soundorui)
describes how the native runtime implements it.
