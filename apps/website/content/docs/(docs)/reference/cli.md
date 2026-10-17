---
title: 'CLI'
description: 'Commands, bundling, development sessions, DevTools inspection, and diagnostics.'
---

Source: [`packages/cli/`](https://github.com/soundor/soundor/tree/main/packages/cli).

Command line interface for creating, developing, validating, and building
Soundor projects.

## Install

```sh
pnpm add -D soundor
```

## Usage

```sh
soundor init      # scaffold the runtimes' host projects
soundor gen       # regenerate .soundor/generated (types, C++ framework)
soundor dev juce  # develop with the JUCE runtime (or: soundor dev web)
soundor build     # production build of the plugin
soundor doctor    # check the toolchain
```

## The plugin UI bundle

A plugin's UI is TypeScript or TSX in `src/main.tsx` (or `main.ts`, `main.jsx`,
`main.js`). `soundor dev` and `soundor build` bundle it with
[tsdown](https://tsdown.dev) into one JavaScript file that the plugin embeds
and runs in Soundor's runtime:

- Everything it imports from npm is inlined. `soundor:*` modules stay imports;
  the runtime provides them.
- `build` minifies and tree-shakes into `.soundor/ui/production`. `dev` keeps
  source maps, in `.soundor/ui/development`.
- TSX uses the automatic JSX runtime (set `"jsx": "react-jsx"` in the
  tsconfig). `process.env.NODE_ENV` is replaced at build time, since the runtime
  has no `process`.
- `import logo from './logo.png'` (also `.jpg`, `.jpeg`, `.webp`) bundles the
  image as an asset and yields its stable, content-derived id.

### Development

`soundor dev` builds the plugin in debug mode once, then keeps rebuilding the UI
whenever a project file changes. The plugin loads the UI from
`.soundor/ui/development` instead of embedding it, and on every successful build
replaces its JavaScript runtime with a fresh one: timers, subscriptions, open
parameter gestures and pending work of the old UI all end. State lives in the
plugin (parameters) or in `soundor:storage`, so it survives a reload.

- A failed build is reported in the terminal; the plugin keeps running the last
  good build.
- The plugin's `console` output and uncaught errors appear in the terminal,
  whichever process the plugin runs in (a DAW or the Standalone), with stack
  frames mapped back to your TypeScript sources.
- Changes to `soundor.config.ts` or native code need a restart of `soundor dev`.

When the runtime is ready, `dev` prints a summary: the plugin, the DevTools URL
and what the runtime adds (the JUCE runtime's build output and Standalone, the
Web host's URL). In a terminal, the output of the native build is collapsed
into one progress line; all of it is kept in `.soundor/dev/build.log`, and a
failed build prints it. Type a key and enter for a shortcut:

| Key | Action                                                          |
| --- | --------------------------------------------------------------- |
| `h` | Show the shortcuts                                              |
| `u` | Show the summary again                                          |
| `o` | Open DevTools in the browser, signed in                         |
| `c` | Copy a signed-in DevTools link (it works once, within a minute) |
| `s` | JUCE: launch the Standalone again                               |
| `w` | Web: open the Web host in the browser                           |
| `q` | Quit (as Ctrl+C)                                                |

`c` uses the platform's clipboard command; over SSH, or without one, it asks
the terminal to copy the link (OSC 52), which most terminals support. Outside
a terminal (piped, or in CI) there are no shortcuts and the build output is
printed as is.

`dev` discovers optional DevTools support from the runtime's capability
declaration, independent of its name. For supported runtimes it resolves
[user settings](/docs/reference/config#user-settings) before running development;
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

### Native DevTools inspector

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

### Animation and performance diagnostics

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

TypeScript types for the runtime are generated into
`.soundor/generated/soundor.d.ts`: the `soundor:*` modules, image imports, and
exactly the Web APIs the runtime provides. Use them with `lib: ["ES2023"]` and
without `"DOM"`, so code that assumes a browser fails to compile:

```jsonc
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "types": [],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "bundler",
  },
  "include": ["src", ".soundor/generated/soundor.d.ts"],
}
```

The bundler never ships with the plugin: the plugin contains plain JavaScript
only.

## License

MIT

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
