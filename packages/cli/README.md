# soundor

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
soundor dev       # development build of the plugin
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

`dev` discovers optional DevTools support from the runtime's capability
declaration, independent of its name. For supported runtimes it resolves
[user settings](../config/README.md#user-settings) before running development;
unsupported runtimes do not load these settings. Set `devtools.enabled` to
`false` to disable debugging. The session server serves the browser dashboard at
the displayed URL, using port 4545 by default. Only an implicit default advances
to the next port when occupied; explicit collisions report a fix. The server
binds to loopback and stops with the development lifecycle.

Set `devtools.open:true` to open and authorize the first browser tab automatically
with a one-use ticket. Otherwise enter the `browserKey` from your protected
session descriptor whose path is printed in the terminal into the dashboard. Keys are
never printed in logs. Browser tabs can observe targets concurrently; native
debug interactions require explicit control of the selected target. See the
[protocol contract](../devtools-protocol/README.md) for transports and security.

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
are documented in the [debug protocol](../devtools-protocol/README.md).

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
