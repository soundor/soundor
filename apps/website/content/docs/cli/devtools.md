---
title: 'DevTools'
description: "Inspect a running plugin's UI from the browser: its node tree, animations and rendering."
---

[`soundor dev`](/docs/cli/dev) starts a DevTools session for a runtime that
supports it (the JUCE runtime): a dashboard in the browser that inspects the
plugin's real UI, live.

## The session

`dev` discovers optional DevTools support from the runtime's capability
declaration, independent of its name. For supported runtimes it resolves
[user settings](/docs/cli/config#user-settings) before running development;
unsupported runtimes do not load these settings. Set `devtools.enabled` to
`false` to disable debugging. The session server serves the browser dashboard at
the displayed URL, using port 4545 by default. Only an implicit default advances
to the next port when occupied; explicit collisions report a fix. The server
binds to loopback and stops with the development lifecycle.

Set `devtools.open:true` to open and authorize the first browser tab automatically
with a one-use ticket. Otherwise press `o` (open) or `c` (copy a link) for a
signed-in tab, or enter the `browserKey` from your protected session descriptor
whose path is printed in the terminal into the dashboard. Keys are never
printed in logs. Several tabs (and [Driver](/docs/driver) scripts) work with
a target at once: each has its own highlight, picker and synthetic input. See the
[protocol contract](/docs/contribute/devtools-protocol) for transports and security.

## Inspecting the native UI

For JUCE Standalone development, select a connected target to inspect the actual
native UI hierarchy. Expand nodes or search by type, text, accessibility role/name,
or node/debug ID. Selecting a node shows its real properties, layout and bounds,
normalized base styles, current presentation values, and accessibility metadata.
Unsupported fields are omitted. The application remains in its native window.

Hovering or selecting tree nodes highlights them in the native window. Each
tab has its own highlight, and the window draws every tab's. Click
**Select element**, then click a native control: DevTools expands its ancestors,
scrolls to the selected node, and shows its details. The selection click does not
activate the application control. Escape cancels picking in either window.
When several tabs pick at once, the click selects the node in each of them;
other tabs keep their own selection. Switching targets or closing a tab
removes its highlight and picker.

The details of a selected node offer **Click**, **Hover** and
**Focus** (focusable nodes): the target's synthetic input, through the
engine's own hit testing and event dispatch, as
[Soundor Driver](/docs/driver/interacting) sends it. A click goes to the
node's center; when another node covers it there, nothing is sent and the
notice says what covers it. Each tab's pointer is its own, beside the real
mouse and other tabs'. Targets without the `input` capability show no
such actions.

**Screenshot** (targets with the `capture` capability) captures the view as
the engine renders it and shows it, with its size and scale and a
**Download** link for the PNG. Closing the preview frees
the server's copy; see [screenshots](/docs/driver/screenshots).

Ordinary tree updates retain surviving selections. Reload, node removal, and
process disconnection invalidate references safely. WebSocket reconnect restores
inspection as a new client: the old connection's highlight and held input
are gone. Large snapshots are
bounded; the picker can fetch omitted nodes and their ancestors on demand.

The Console preserves existing mapped source locations and multiline error
stacks, with timestamps, severity, text filtering and a per-tab Clear action.
It retains the most recent 1,000 entries. The current CLI log file represents the
development session, so these logs are labelled as session logs rather than
attributed to a particular instance. Neither clearing nor filtering affects
application logging or other tabs. The dashboard follows the browser's light or
dark theme and supports keyboard tree navigation.

## From scripts

[Soundor Driver](/docs/driver) works with the same session from Node.js and
from `soundor driver`: the tree, node details, locators and input, for
scripts and coding agents. It signs in like a dashboard tab and can run beside one.

## Animations and performance

The **Animations** panel reads native active/paused animations and their target
properties, elapsed time, duration/delay, easing or spring metadata, and current
presentation values. Node selection filters active results; **Clear selection**
returns to all nodes. Recent engine lifecycle events show pause/resume,
replacement cancellation, completion and cancellation. Reload clears this history.

In **Performance**, click **Start recording**. The panel shows
measured CPU frame/layout/node raster/composition work, actual CPU/GPU compositor
mode, layer/work counters, and a bounded frame-duration chart. An instance has
one recording, which every tab shows and any tab starts or stops.
**Stop recording** preserves samples for inspection; starting
again begins a new recording. It stops by itself when every tab that started
it is gone; reload discards it.
Capture is sampled at up to 10 Hz, with at most 300 frame samples. An unchanged UI
may render no frames: tick phases still report their real work. Delayed UI ticks
are reported separately from GPU presentation. GPU execution and total Hermes
execution time are not measured; no audio-thread profiling is performed.

Property inspection remains read-only because the renderer has no safe temporary
override layer independent of React-owned styles and native animation ownership.
Nodes also lack reliable component/TSX source metadata; mapped error stacks remain
available in the Console. These limitations and the typed measurement contract
are documented in the [debug protocol](/docs/contribute/devtools-protocol).

## How it fits together

The CLI resolves the installed `@soundor/devtools-client` production directory
and supplies it to `@soundor/devtools-server`. The server and browser application
are maintained independently; `@soundor/devtools-protocol` remains their shared
contract. See [the server API](/docs/contribute/devtools-server) and
[frontend development and tests](/docs/contribute/devtools-client).
The CLI owns user settings, default-port fallback, browser opening, mapped log
forwarding and runtime shutdown. Its production build does not include simulators.

```sh
pnpm --filter soundor test:devtools-consumer
```

This packs and installs the CLI, both DevTools packages and their workspace
dependencies in an isolated consumer, then verifies installed asset resolution
and serves production chunks without a native plugin.

To develop the frontend against this CLI's live native backend, start the CLI
with `SOUNDOR_DEVTOOLS_ORIGIN=http://127.0.0.1:5173`. The server validates this
as one exact HTTP loopback origin; ordinary sessions keep their normal Origin
restrictions. In another terminal, set `SOUNDOR_DEVTOOLS_BACKEND` to the
credential-free backend URL when starting the client. See the
[external-backend workflow](/docs/contribute/devtools-client). The client never owns
or shuts down a backend started by the CLI.
