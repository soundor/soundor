---
title: 'Screenshots'
description: 'Capture a running plugin’s view as its engine renders it, as PNG, from scripts, the CLI and DevTools.'
---

A screenshot is the plugin's view as its engine renders it: the engine's own
renderer draws the current UI into pixels and encodes them as PNG. It is not
an OS screenshot of a window, needs no screen-capture permission, and is the
same whether the plugin's window is covered, off-screen or minimized.

```ts
const shot = await driver.screenshot({ path: './plugin.png' });
console.log(shot.width, shot.height, shot.scale); // device pixels, and their scale

const knob = await driver.getByDebugId('gain').screenshot();
// knob.data: the PNG's bytes (a Uint8Array)
```

```sh
soundor driver screenshot ./plugin.png
soundor driver screenshot ./gain.png --debug-id gain
```

## What a capture holds

| Field             | What it is                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `data`            | The PNG file's bytes.                                                                          |
| `width`, `height` | Its size in device pixels: the view's logical size times `scale`.                              |
| `scale`           | Device pixels per logical pixel, as the view was shown (2 on a Retina display).                |
| `format`          | `png`.                                                                                         |
| `path`            | Where it was saved, when `path` was given (relative paths resolve from the working directory). |

`locator.screenshot()` keeps the part of the view the node's
[bounds](/docs/driver/inspecting#coordinates) cover, clipped to the view.

The view is drawn as the engine renders its layers, with the plugin's current
styles, animations at their present values, text, images and canvases (a
WebGL canvas is read back from the GPU once for the capture). Where the
plugin draws nothing, the PNG is transparent: the host window's background
is not part of the view. DevTools' highlight is not drawn.

Capturing reads the view: it needs the target's `capture` capability, and
works while other clients use the target. It renders on
the plugin's UI thread, so capture occasionally rather than in a tight loop.

## Errors

- `MISSING_CAPABILITY`: the target cannot capture (its runtime does not
  advertise `capture`).
- `SCREENSHOT_UNAVAILABLE`: the view has no size yet, it is bigger than the
  limits, the node shows nothing inside the view, or the capture was lost in
  transfer. The session stays usable.
- `INVALID_OPTIONS`: the PNG could not be saved at `path` (the capture itself
  succeeded).

## How captures travel

Messages between clients, the server and runtimes are JSON of at most 1 MiB,
too small for images, so captures travel apart, as binary HTTP:

1. The client sends `Capture.screenshot` (optionally with a node).
2. The runtime renders and encodes the PNG on its UI thread, then its worker
   uploads it to `POST /runtime/captures/<request>` with the target's
   credentials, and answers the request with its size. The server accepts an
   upload only for a pending capture request of that same target, only once,
   only a PNG, and at most 32 MiB.
3. The server keeps the capture under a fresh unguessable ID and answers the
   client with it.
4. The client reads `GET /browser/captures/<id>` with its session cookie
   (the browser key's sign-in, from the session's own origin), then deletes it
   (`DELETE`). The native runtime's credentials cannot read captures.

A session keeps at most 8 captures, each for 60 seconds at most, and drops a
client's captures when it disconnects and a target's when it goes. Captures
are limited to 8192 pixels a side and 16 megapixels.
