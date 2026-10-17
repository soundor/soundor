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
printed in logs. Browser tabs can observe targets concurrently; native
debug interactions require explicit control of the selected target. See the
[protocol contract](/docs/contribute/devtools-protocol) for transports and security.

## Inspecting the native UI

For JUCE Standalone development, select a connected target to inspect the actual
native UI hierarchy. Expand nodes or search by type, text, accessibility role/name,
or node/debug ID. Selecting a node shows its real properties, layout and bounds,
normalized base styles, current presentation values, and accessibility metadata.
Unsupported fields are omitted. The application remains in its native window.

Click **Request control** to enable native highlighting and the element picker.
Hovering or selecting tree nodes highlights them in the native window. Click
**Select element**, then click a native control: DevTools expands its ancestors,
scrolls to the selected node, and shows its details. The selection click does not
activate the application control. Escape cancels picking in either window.
Observer tabs can select and read nodes independently; picking updates the
controller's selection. A valid lease cannot be stolen. Release it explicitly,
switch targets, or close the controlling tab to make it available.

Ordinary tree updates retain surviving selections. Reload, node removal, and
process disconnection invalidate references safely. WebSocket reconnect restores
inspection, but never reacquires control automatically. Large snapshots are
bounded; the picker can fetch omitted nodes and their ancestors on demand.

The Console preserves existing mapped source locations and multiline error
stacks, with timestamps, severity, text filtering and a per-tab Clear action.
It retains the most recent 1,000 entries. The current CLI log file represents the
development session, so these logs are labelled as session logs rather than
attributed to a particular instance. Neither clearing nor filtering affects
application logging or other tabs. The dashboard follows the browser's light or
dark theme and supports keyboard tree navigation.

## From scripts

[Soundor Driver](/docs/driver) reads the same session from Node.js and from
`soundor driver`: the tree, node details and locators, for scripts and coding
agents. It signs in like a dashboard tab and can run beside one.

## Animations and performance

The **Animations** panel reads native active/paused animations and their target
properties, elapsed time, duration/delay, easing or spring metadata, and current
presentation values. Node selection filters active results; **Clear selection**
returns to all nodes. Recent engine lifecycle events show pause/resume,
replacement cancellation, completion and cancellation. Reload clears this history.

In **Performance**, request control and click **Start recording**. The panel shows
measured CPU frame/layout/node raster/composition work, actual CPU/GPU compositor
mode, layer/work counters, and a bounded frame-duration chart. Observers can read
the same recording. **Stop recording** preserves samples for inspection; starting
again begins a new recording. Control release, disconnect and reload discard it.
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
