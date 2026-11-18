---
title: 'Web runtime'
description: 'Browser host, DOM semantics, Web Audio, TypeScript API implementations, and static builds.'
---

Source: [`runtimes/web-runtime/`](https://github.com/soundor/soundor/tree/main/runtimes/web-runtime).

Runs a Soundor plugin in the browser.

The plugin contract you declare once in `soundor.config.ts` (identity,
parameters, native API) is implemented here with TypeScript, the DOM and Web
Audio, where the JUCE runtime implements it with C++. The plugin UI is the
same: the same `src/main.tsx`, the same `@soundor/react` components, the same
`soundor:*` modules.

```text
                   soundor.config.ts
                          │
                 generated contract
                    /             \
     @soundor/juce-runtime     @soundor/web-runtime
          C++ / JUCE           TypeScript / browser APIs
                    \             /
                 src/main.tsx (@soundor/react)
```

This is not the JUCE plugin compiled for the Web. The browser's own engine runs
the plugin UI's JavaScript and draws it, without Hermes or Skia, and your Rust controller and processor run through WebAssembly. The UI's engine is Soundor's
own, though: its C++ core (the node tree, styles, Yoga layout and text layout,
the same code the JUCE runtime compiles) runs as WebAssembly, so a UI gets the
same boxes and the same style errors in both runtimes, and the browser draws
them with HTML elements and CSS. A page with a strict Content Security Policy
has to allow it, with `wasm-unsafe-eval`.

That module (`soundor-core.wasm`, about 150 KB compressed) is precompiled: it
comes from the installed `@soundor/engine`'s prebuilt release, downloaded once
into the Soundor cache and verified when `soundor dev` or `soundor build`
first needs it, then served from your own site like any asset. A web plugin
needs no Emscripten, CMake or C++ compiler; Rust compiles its controller and processor
([Audio](#audio-the-plugins-processor-in-webassembly)). See
[Soundor Engine](/docs/engine#the-webassembly-core).

## Usage

```ts
// soundor.config.ts
import { defineSoundorConfig } from '@soundor/config';
import { juceRuntime } from '@soundor/juce-runtime';
import { webRuntime } from '@soundor/web-runtime';

export default defineSoundorConfig({
  plugin: { id: 'com.example.gain', name: 'Gain' },
  runtimes: [juceRuntime(), webRuntime()],
  parameters: {
    gain: { type: 'float32', label: 'Gain', min: 0, max: 1, default: 0.5 },
  },
});
```

Soundor manages the complete Web host, including HTML, browser services, audio
and its build system. There is no `runtimes/web/` project or web initialization
step. A newly created project can run immediately:

```sh
pnpm create soundor-app my-plugin
cd my-plugin
pnpm dev:web       # choose JUCE + Web in the scaffolder
```

For a web-only project the scaffolder names this script `dev`.
Existing projects can add `webRuntime()` to their runtimes and run:

```sh
soundor dev web
soundor build web   # static site in .soundor/dist/web
soundor doctor     # Node.js, Vite, Rust for WebAssembly, migration checks
```

`port` selects the development port (5173 by default, or the next free one).
`inputs` selects the optional audio sources:

| Configuration      | Behavior                                  |
| ------------------ | ----------------------------------------- |
| omitted            | Oscillator, audio file, microphone        |
| built-in array     | Exactly those sources, in that order      |
| module path string | The module's default-exported input array |
| `[]`               | No optional sources                       |

**No input** is always available. Explicit lists replace defaults. The initial
selection is the first oscillator or custom input, or No input if neither is
present. File and microphone always require explicit selection.

### Built-in inputs first

Prefer the built-in inputs before implementing your own. For example:

```ts
import { webRuntime } from '@soundor/web-runtime';

// In soundor.config.ts's runtimes array:
webRuntime({
  inputs: [
    { type: 'oscillator', waveform: 'sine', frequency: 440, gain: 0.2 },
    { type: 'file' },
  ],
});
```

`oscillator` defaults to a triangle at 220 Hz and gain 0.3. Frequency must be
positive and finite; gain is between 0 and 1. Supported waveforms are `sine`,
`square`, `sawtooth` and `triangle`. `file` uses the existing file picker and
loops at the transport position. `microphone` uses browser capture with echo
cancellation, noise suppression and automatic gain control disabled.
Duplicate types, unknown options and invalid values are errors.

If built-ins are insufficient, use a [custom input module](#custom-inputs).
Consider contributing broadly useful sources to Soundor's built-in collection.

## Lifecycle and ownership

You own your UI in `src/`, Rust code in `lib/`, and optional browser input
modules. Soundor owns the host inside `@soundor/web-runtime`; no implementation
files are copied into your project.

| Phase    | What it does                                                                                 |
| -------- | -------------------------------------------------------------------------------------------- |
| `gen`    | Writes contracts under `.soundor/generated/runtimes/web/`, checked by `soundor gen --check`. |
| `dev`    | Serves the installed host until Ctrl+C.                                                      |
| `build`  | Emits a static site with relative URLs in `.soundor/dist/web/`.                              |
| `doctor` | Checks Node.js, Vite, Rust's WASM target and legacy host migration.                          |

The manifest includes plugin metadata, parameters, state and the native API.
Generated `parameters.js` provides compiled parameter behavior; `native.ts`
provides typed event and stream publishers. Generated files are never edited.
The installed package brings its browser dependencies and Vite; no extra
package.json, HTML or Vite configuration is needed. The plugin's `public/`
directory, if present, supplies static files.

## Development and builds

The CLI bundles the shared plugin UI just as for every runtime. The Web host
loads that bundle with its `soundor:*` modules resolved to browser services.
Successful UI builds reload the page; a failed UI rebuild keeps the last
working bundle. Custom input modules and their imports are compiled separately
for the browser and update through the development server. Rust edits rebuild
the processor and controller, then reload the page. Config changes need a restart.
Browser logs and uncaught errors appear in the terminal during development.
Production output contains the host, UI, WASM and bundled input code and assets.

## Browser TypeScript environment

Keep browser input code separate from the shared UI: the UI runs in every
runtime and deliberately has no DOM globals. Projects using only built-in inputs
need no browser TypeScript project. When adding a custom input module, create
`tsconfig.web.json` and reference it from the solution-style `tsconfig.json`.
`tsconfig.app.json`, Node, test and E2E references keep their existing roles.

Add this browser project and append
`{ "path": "./tsconfig.web.json" }` to the root's `references`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": [],
    "strict": true,
    "skipLibCheck": true,
    "composite": true,
    "noEmit": true,
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.web.tsbuildinfo"
  },
  "include": ["web/**/*.ts", "web/**/*.js"]
}
```

Run `soundor gen && tsc -b` to check all projects. DOM and Web Audio declarations
come from TypeScript, not the input helper. Include generated module declarations
individually only if your custom code imports the corresponding `soundor:*` APIs.
For JavaScript diagnostics enable `allowJs` and `checkJs`. If you remove all
custom input code, remove the browser project and its root reference too.

The input path can be anywhere in the plugin project: for example
`inputs: './audio/sources.ts'`. Add that directory and any local imports to
`tsconfig.web.json`'s `include`; the runtime always resolves the entry relative
to the plugin root, regardless of the working directory. Browser input modules
are never evaluated while Node loads `soundor.config.ts`. Use normal local
and npm imports; browser dependencies must be installed in your project.
The dev server shows syntax/import errors; run TypeScript for semantic errors.

## Migration

Older versions scaffolded a user-owned `runtimes/web/`. Development and builds
now reject that directory, even when `inputs` is explicitly set, to avoid
silently ignoring customizations. Soundor never deletes your files.

1. Move custom source definitions out of `runtimes/web/src/main.ts` into a
   browser module, for example `web/inputs.ts`, with a default-exported array.
2. Use `@soundor/web-runtime/input` for input types, `defineInput` and factories.
   Include factories for any default sources you want to keep. Place a custom
   source first to make it the initial selection.
3. Set `webRuntime({ inputs: './web/inputs.ts' })` and add the browser TypeScript
   project above. Replace `tsc -p runtimes/web` with the solution's `tsc -b`
   and remove any root reference to the old `runtimes/web/tsconfig.json`.
4. Review other custom host code and assets. Move static files to `public/` and
   source-owned assets next to the module. HTML, host presentation overrides and
   Vite customizations have no managed-host configuration equivalent. The old
   `@soundor/web-runtime/vite` entry is removed. Preserve needed code before
   deleting the legacy directory yourself.

If you never customized the host, remove `runtimes/web/` and its old typecheck
script suffix. No input option is needed: defaults stay the same. Preserve
your shared Rust crate and other user-owned files.

## `soundor:*` in the browser

One page (or iframe) runs one plugin, with one host context. All of these
share that context: the plugin UI, Rust controller services and the host
UI. Controller calls use schema-driven WASM dispatch.

| Module               | In the browser                                                                                                                                                                                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `soundor:parameters` | One parameter store, running the behavior `gen` compiles from the config to JavaScript (`parameters.js`), from the same expressions as the JUCE runtime's C++: mapping, steps, `format` and `parse`. A value of the wrong type, or a write to a read-only parameter, is a `TypeError`; listeners hear of changes only, and gestures nest. |
| `soundor:host`       | `WebHost`: host name "Soundor Web", the AudioContext's sample rate, a 128-sample block, and a transport the host UI controls. Snapshots arrive every frame while playing.                                                                                                                                                                 |
| `soundor:ui`         | The DOM (see below).                                                                                                                                                                                                                                                                                                                      |
| `soundor:native`     | The same generated TypeScript methods as natively, dispatched to the Rust controller in WASM.                                                                                                                                                                                                                                             |
| `soundor:storage`    | IndexedDB, one database per `plugin.id`.                                                                                                                                                                                                                                                                                                  |
| `soundor:fs`         | A private file tree in the same database. Relative, `/`-separated paths that cannot leave it; atomic writes; the JUCE runtime's errors. The user's own files are never reachable.                                                                                                                                                         |

The Web globals Soundor declares (`fetch`, timers, `URL`, `TextEncoder`,
`crypto`, `requestAnimationFrame`, …) are the browser's own, except
`ResizeObserver`. A browser's observes DOM elements only, so Soundor's takes
its place and observes nodes. The browser still decides when it reports, through
its own `ResizeObserver` on each node's element. What an entry says is measured
from Yoga, as in the JUCE runtime. DOM elements are passed through to the
browser's, so the host page's own code works as before.

### `soundor:ui` on the DOM

Each `UiNode` draws with one DOM element inside the plugin viewport (the
editor's size, scaled down when the page is smaller; see
[The host UI](#the-host-ui)). The renderer is
`@soundor/react`'s own; there is no ReactDOM. Plugin code only ever sees
UiNodes.

- **Layout.** The engine decides every box, with its Yoga, as in the JUCE
  runtime, and each element is placed absolutely where it says: CSS only draws. `flex` is read as React
  Native reads it, and invalid styles fail with the JUCE runtime's messages. What
  still differs is listed in [Where layout differs](#where-layout-differs).
- **Events.** Events capture and bubble along the Soundor tree, and input
  follows the JUCE runtime's rules: implicit pointer capture, hover enter and
  leave along the tree, a click to the deepest node holding both press and
  release, counted as the browser counts clicks (its own `click`'s `detail`,
  by the platform's double-click time) with a `dblclick` after the second,
  focus on press, Tab cycling, `focusVisible` (by the JUCE
  runtime's rules, not the browser's `:focus-visible`), and the wheel
  scrolling the nearest scroll view. With Control, the wheel, a trackpad's
  pinch included, scrolls nothing and is left to the browser's zoom unless
  plugin code prevents it. All four `pointerEvents` modes work, and the cursor is the
  JUCE runtime's: the view resolves `cursor` along the Soundor tree and
  shows it on its element, which every node inherits. Hover follows what
  changes under a pointer that did not move (the tree, a style, a scroll, a
  resize) in the next frame, as in the JUCE runtime.
- **Text inputs** edit natively (IME, selection, copy and paste) and report
  `beforeinput`, `input` and `change`. A press in one is left to the browser
  rather than captured by the view, so selecting with the mouse works in
  every browser; it still goes to the input until it is released.
- **Pointer lock** is the page's: `requestPointerLock()` locks the view's
  element, and the view routes the moves to the node that asked. The browser
  allows it during a press, ends it on Escape, may refuse it (the promise
  rejects, the press goes on), and Firefox shows a banner while it lasts.
  `movementX`/`movementY` are the browser's, in the view's logical pixels.
- **`screenX`/`screenY`** are the browser's, in the editor's pixels: the
  page's CSS pixels over the scale the host page fits the plugin into its
  stage with (1 unless the stage is smaller than the plugin).
- **Layers.** `root` and `overlayRoot` are two elements in one isolated
  stacking context inside the viewport, the overlay above; every node
  stacks its own children, so `zIndex` orders siblings as in the JUCE
  runtime and never lifts content over the overlay. Nothing is rendered
  into `document.body`.
- **Coordinates** are logical pixels relative to the view, whatever the
  viewport's scale: `pageX`/`pageY`, `getBoundingClientRect()`. The DOM's
  `contextmenu` becomes Soundor's, and preventing it keeps the browser's
  menu away.
- **Accessibility** is ARIA on the elements that draw the nodes: no second,
  hidden DOM, and no native accessibility adapter. The JUCE runtime's semantic rules decide
  what is an element, as what, labelled how; a pass after each task's
  changes sets the matching attributes:
  - Roles: `adjustable` is `slider`, `togglebutton` a `button` with
    `aria-pressed`, `header` a `heading`, `summary` a `region`,
    `keyboardkey` a `button`; most others keep their name. A text input
    stays a native `<input>` (labelled with `aria-label`), an image an
    `<img>` whose `alt` is its label (empty while decorative), a canvas a
    `<canvas>` with role `img` once labelled.
  - Label: `aria-label`, or for an element read whole (a button, a slider)
    the text inside it; hint: `aria-description`; state: `aria-disabled`,
    `aria-selected`, `aria-checked` (or `aria-pressed`), `aria-expanded`,
    `aria-busy`; ranges: `aria-valuemin`/`max`/`now`/`text`.
  - `accessible: false` leaves a node without role or label, and hides a
    text node's own text; what a view holds is still read.
  - `accessibilityParent` is `aria-owns` on the parent: a portal opened
    from a modal is read inside it.
  - While a modal element shows, it is `role="dialog"` with
    `aria-modal="true"`, and everything outside it (and what it owns) is
    `aria-hidden`; a modal opened from it supersedes it. Nothing is made
    `inert`, so focus restoration and pointer input stay the modal's.
  - A click no pointer made (`detail` 0: a screen reader activating an
    element) is the `activate` action of the nearest element offering it.
    Pointer clicks come from the view's own press and release, so a press
    is never delivered twice; only their count is the browser's: a real
    release waits for the browser's `click` right after it, and is a single
    click when none comes (the element pressed was removed). Other actions have no DOM path: screen
    readers adjust sliders with the arrow keys, which a control handles
    itself.

### Where layout differs

Both runtimes lay out with the same engine code, so a box is the same in both
to the last bit, given the same text sizes. What remains is what
the browser itself decides:

- **Text** is measured by Skia natively and by the browser here, with the
  platform's fonts in each, so a text's width, and where it wraps, can differ by
  a few pixels. Bundled fonts narrow this; they do not remove it. It wraps by the
  JUCE runtime's rules in both: only at spaces and line breaks, never inside a
  word, at a hyphen or between CJK characters. Baselines are the JUCE runtime's
  too, in text and in inputs, on the device pixel it would use: the browser's
  rounding of a font's metrics, which moves text by a pixel between 1x and 2x, is
  corrected for. Glyphs still differ by what each renderer hints.
- **Scroll views** (views whose style scrolls) scroll as far in both, and draw
  the same thin indicators, not the browser's scrollbar. What moves them is the
  browser's here, so its momentum on a trackpad is its own, and after touch the
  bars show only while scrolling. A smooth `scrollTo()` is the runtime's, not
  the browser's, for the same curve as natively.

## Native API in Rust

Every plugin exports a Rust `PluginController`, even with no configured
methods. The browser executes the same `NativeMethods` implementation as
the native runtime through WASM. Generated contracts validate method names,
arguments, results, state and resource types before initialization.

The controller's stores live for the plugin instance, independently of UI
mounts. Its typed services use the page's parameter, state, History and
factory preset stores. Async methods return promises, execute cooperatively
on the main thread, and schedule control operations through event-loop
tasks. No worker is required; CPU-heavy work must yield to keep the browser
responsive. `unblock()` is restricted to native targets.

The AudioWorklet remains a separate execution context and WASM instance.
Controller resource publications travel through MessagePort and are
installed between audio callbacks, preserving block-boundary ownership.

See [Rust controller](/docs/rust-controller) for stores, scheduling,
cancellation, browser limitations and migration from `WebNativeApi`.

## Audio: the plugin's processor, in WebAssembly

The Web host runs the same audio processing as the JUCE plugin: the
project's Rust crate, `lib/`, compiled to WebAssembly
(`wasm32-unknown-unknown`) and run in an AudioWorklet. There is no Web Audio
code of your own to write, and nothing to keep in step with the plugin's
DSP. See [The audio processing](/docs/juce-runtime#the-audio-processing) for
the processor itself.

```text
source → input bus → the processor (AudioWorklet) → output bus → master gain → speakers
```

- **Building.** `soundor dev web` and `soundor build web` compile `lib/`
  with Cargo (`cargo rustc --crate-type cdylib --target
  wasm32-unknown-unknown --release`, in `.soundor/cache/lib`) before
  Vite runs. The module is part of the bundle, so a static build needs no
  other file and works below any path and in iframes. A change to `lib/`
  during `soundor dev web` builds it again and reloads the page.
- **Requirements.** Rust and its `wasm32-unknown-unknown` target
  (`rustup target add wasm32-unknown-unknown`), which `soundor doctor`
  checks. Neither wasm-bindgen nor `SharedArrayBuffer` is used: the page
  needs no cross-origin isolation headers.
- **The worklet.** The engine's (`@soundor/engine/web/processor`), loaded
  only once there is a processor to run. The module is compiled on the audio rendering thread and
  owns its buffers in its own memory. Each render quantum's input is copied
  in, processed in place, and copied out. Render quanta of any length work; a
  longer one is processed in blocks of at most 1024 frames.
- **Parameters and transport.** The parameters' plain values and the host's
  transport (tempo, position, playing, time signature) are posted to the
  worklet when they change, and the processor reads them at the start of
  each block. Read-only parameters (meters) are the processing's to set:
  what it publishes comes back and updates the UI and the host's controls.
  Streams the processor publishes reach `soundor:native`'s streams about
  60 times a second.
- **State.** The state fields declared with `audio: true` are posted to the
  worklet as one snapshot when any of them changes, once per batch of changes
  (a transaction's or a restore's fields together), and the processor reads
  the latest from the start of its next block, as `ctx.state`.
- **Buses.** The host feeds the main input bus and plays the main output.
  A sidechain or an auxiliary bus is present but silent.
- **Failure.** If the module cannot run (it was built from another
  `soundor.config`) the input passes straight through, and the panel's Audio
  section says why. A panic in the processor traps the module: the output is
  silent until the audio restarts, and the panel reports it.
- The host owns one AudioContext. Browsers allow audio only after a user
  gesture, so the host creates the context on the page's first one, wherever
  it is: a click or key on the plugin, Play, any host control.

### Microphone input

Open **Host settings → Audio → Input**, choose **Microphone**, then press
**Play**. The browser requests permission; capture feeds the same input bus
as an oscillator or audio file and passes through the processor.
The panel shows when it is waiting for permission, capturing, or unable to
start, and offers **Retry input** after a failure.

Microphones require [HTTPS or localhost and browser permission](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
An embedded host also needs microphone permission from its parent; use
`allow="autoplay; microphone"` on the iframe, subject to the parent's
Permissions Policy. The docs' live examples include that permission.

Pause, Stop, another input, or disposing the host disconnects the source and
stops every captured track. Play opens a new stream. Muting the output only
silences playback; it does not stop capture. If a permission request resolves
after you have moved to another input or stopped playback, its stream is
immediately released. The browser's pending permission prompt itself may
remain open until answered.

The host requests audio without echo cancellation, noise suppression or
automatic gain control so that effects receive the source audio; the browser
may not support every constraint. Use headphones when monitoring a microphone.
No audio is recorded or uploaded by the host.

### Custom inputs

Use a browser module when the built-ins do not cover your source:

```ts
// soundor.config.ts: in runtimes
webRuntime({ inputs: './web/inputs.ts' });
```

```ts
// web/inputs.ts
import {
  defineInput,
  oscillator,
  audioFile,
  microphone,
} from '@soundor/web-runtime/input';

const fifth = defineInput({
  id: 'fifth',
  label: 'Open fifth',
  start({ context, destination }) {
    const level = context.createGain();
    level.gain.value = 0.15;
    level.connect(destination);
    const notes = [220, 330].map((frequency) => {
      const note = context.createOscillator();
      note.frequency.value = frequency;
      note.connect(level);
      note.start();
      return note;
    });
    return () => {
      for (const note of notes) {
        note.stop();
        note.disconnect();
      }
      level.disconnect();
    };
  },
});

export default [
  fifth,
  oscillator({ frequency: 110 }),
  audioFile(),
  microphone(),
];
```

This uses the existing `WebAudioInput` contract: a unique nonempty `id`, display
`label` and `start` returning cleanup synchronously or asynchronously. The helper
provides inference without changing behavior. Built-in identifiers `oscillator`,
`file`, `microphone` and `none` are reserved for their definitions. Duplicate ids
and invalid exports fail visibly at host startup; missing modules, exports or
imports are reported by the build or development server. Invalid explicit
configuration never falls back to defaults. Modules must default-export an array.

The first eligible source is selected initially (here `fifth`). Sources appear
in the same Input selector in every presentation, although embed hides controls.

The host calls `start` on Play, after the project's DSP is ready. Use its
`context` and connect to its `destination`; the host routes that source
through the plugin's DSP and master volume. `timeInSeconds` is the transport
position at startup, useful for resuming a loop.

On pause, source replacement or disposal, the host aborts `signal`, disconnects
the instance's destination, and calls its cleanup. Pass `signal` to fetch and
other cancellable work. Cleanup must release every resource the input owns.
Even if async work ignores cancellation and returns cleanup late, the host
calls that cleanup and keeps its audio disconnected. Stale failures do not
replace the new input's status; current failures appear in the Audio panel.

The [Orbit example](/docs/examples/orbit) registers a synthesized pluck phrase
this way. Its audio processor handles the host input without knowing whether
it came from the demo, a file, or a microphone.

## The host UI

The plugin is the page. Its view opens at the editor's size, the config's
[`editor`](/docs/cli/config#editor) (800×600 by default), as the JUCE editor
does, and is scaled down, never up, when the page is smaller (an iframe in
docs, a phone, the panel open). The host stays out of its way:

```text
┌─────────────────────────────────────────────┬──────────────────┐
│                                             │ Name           ✕ │
│        ┌───────────────────────────┐        │ TRANSPORT        │
│        │                           │        │  Tempo, 4/4, ↻   │
│        │         plugin UI         │        │ AUDIO            │
│        │                           │        │  Input, format   │
│        └───────────────────────────┘        │ PARAMETERS       │
│                                             │  live controls   │
│        [🔊 ──●─ │ ▶ ■ 1.1 │ ⚙]               │ ▸ HOST STATE     │
└─────────────────────────────────────────────┴──────────────────┘
               dock                               panel (closed by default)
```

- **Dock** (floating under the plugin): mute (or, when audio failed to
  start, retry) and the output volume; play/pause, stop and the position
  (bar.beat); the button that opens the panel. Audio needs no button: it
  starts with the first gesture.
- **Panel:** the transport's tempo, time signature and loop (four bars); the
  input source (an oscillator, an audio file, a microphone, a custom input, or no input; a source
  plays while the transport does), the audio format and status; and a control
  per parameter, moving the same values the plugin does. The transport drives
  the same `WebHost` that `soundor:host` reports to the plugin; the plugin
  observes the transport and never controls it.
- **Resizing:** with `editor.resizable`, a handle just outside the view's
  bottom-right corner resizes it (drag it, or focus it and use the arrow
  keys, Shift for larger steps), within the editor's limits and the room
  the page has; a drag the browser cancels puts the size back.
  [Resizing and scaling](#resizing-and-scaling) explains the difference.
- **Presentations:** `soundor dev` (the `dev` presentation) adds the host
  state to the panel and remembers whether the panel was open. A build shows
  the `demo` presentation, or `embed` when opened with `?embed`
  ([Embedding one view](#embedding-one-view)).

### Resizing and scaling

On mobile, the web host follows the visible viewport as the browser toolbars
expand and collapse. The plugin view scales or resizes to fit that space.

Two different things change how big the plugin looks:

- **Resizing** changes the view's size in logical pixels: the size its UI is
  laid out at. A view with `flex: 1` grows with it and text keeps its size,
  as in a resized JUCE editor. Only a resizable editor is resized, by its
  handle (`demo` and `dev`) or by its iframe (`embed`).
- **Scaling** draws the same layout smaller, with a CSS transform, when the
  page has less room than the view's size. Its logical size, and so its
  layout, stay as they were; `viewSize()` reports the scale in `scale`.
- **An editor that scales** (`resize: 'scale'`) is resized by its handle
  the other way: its logical size stays the editor's, and the handle sets
  the size it is drawn at, keeping its aspect ratio, within its limits. That
  zoom and the page's scaling multiply, and `viewSize()` reports both in
  `scale`. In `embed` it fills the iframe as far as its aspect ratio lets
  it, at its own layout.
- **An editor that scales without its aspect ratio**
  (`keepAspectRatio: false`) is resized by its handle to any shape within
  its limits, still zoomed by the smaller side: its layout is drawn in the
  middle of the viewport, with bands of the editor's background around it,
  unless it covers the viewport.
- **An editor that covers** (`fit: 'cover'`) is laid out over the whole
  viewport at its zoom, whatever its shape (one its handle sets, or the
  iframe's in `embed`): `viewSize().safeArea` is the configured size in its
  middle. In `embed` it covers the whole iframe rather than leaving bands.

A fixed-size editor (the default) is only ever scaled, as before. Resizable,
the view opens at its configured size (scaled down if the page is smaller)
and is resized within its limits; dragged past the page's edge, it stops
there rather than being scaled. Its handle is shown only where its limits
allow another size. In `embed` the page owns the size and may make it
larger than its maximum: the editor then lays its UI out as its `fit`
says, as in a JUCE host that ignores the maximum: at most at the maximum,
centred in bands of the editor's background (`'contain'`), or over all of
it around the safe area (`'cover'`).

Plugin code learns of both through
[`useViewSize()`](/docs/hooks/use-view-size) (or `soundor:ui`'s
`viewSize()` and `subscribeViewSize()`): `width` and `height` are the
logical size, and `scale` the device pixels per logical pixel, which counts
the host's scaling. The view measures itself with the `ResizeObserver` that
also keeps hover up to date, watches the page's pixel density, and is told
when the host changes its scaling, which no observer sees.

`soundor:ui`'s [`editorSize()`](/docs/api/ui#the-editors-size) is the
editor's own size, in its logical pixels: the viewport's in `demo` and
`dev` (what the handle sets, before the page's scaling), and the page's in
`embed`, bands included. The page owns that size, so in `embed` it follows
the iframe whatever the editor's limits are.

[`requestEditorSize()`](/docs/api/ui#asking-for-a-size) resizes the
viewport as its handle does: the same size, held to the same limits and
the room the page has, so the two never disagree, and the viewport resizes
with the page's next render. It is the viewport's size, never the browser
window's (no `window.resizeTo()`). In `embed`, and for a fixed editor, the
page owns the size: `editorSize().resizable` is false and requests return
`null`. Each view on a page asks its own host only. The editor stays
centred on the stage as it resizes, so a grip the UI draws in its corner
moves half as far as the pointer, as the host's handle does.

```ts
export default defineSoundorConfig({
  // …
  editor: { width: 800, height: 600, resizable: true },
});
```

## Static builds and iframes

`soundor build web` writes a self-contained static site to
`.soundor/dist/web/`. All its URLs are relative, so it works under any path
(`https://example.com/docs/examples/gain/`), and in an iframe with no code on
the parent page:

```html
<iframe src="/docs/examples/gain/" width="840" height="720"></iframe>
```

Each page or iframe has its own host, parameters, transport, AudioContext and
plugin view. Storage is per plugin id, as in a DAW, where every instance of a
plugin shares its storage.

### Embedding one view

With `?embed`, a build shows the plugin view alone: no dock, no panel, and
the view as big as the page (the iframe), however big that is, rather than
the editor's size scaled down. Its logical size is the iframe's (up to a
resizable editor's maximum, or at its zoom when it scales: see
[Resizing and scaling](#resizing-and-scaling)), and it follows the iframe
when the parent page resizes it, whether or not the editor is resizable:
`editor` sets the size the standalone host opens at and whether it shows a
handle, never an embedding page's layout, and the view never resizes its
iframe: `requestEditorSize()` returns `null` there. It suits a small piece of UI in a docs page,
which is how this site shows its snippets:

```html
<iframe src="/examples/snippets/index.html?embed" height="240"></iframe>
```

Audio still starts with the first gesture on the view. With no transport
controls, the host's input source stays silent; the processor runs as
usual.

## Playground mode

A static build can also run UI code it is sent instead of its own: this is how
the examples on this site can be edited. Opened with
`?playground=<script>`, the host loads that script instead of the plugin UI,
and the script runs the code:

```text
index.html?playground=/playground/kit.js
```

- **The script comes from the page's own origin.** A script from another
  origin is refused, so a link cannot run someone else's code on the page.
- **The host gives it its `soundor:*` modules**: as
  `globalThis.__soundorModules` before the script loads, and to
  `soundorPlayground.start(host)`, which the script defines. `host` also shows
  and clears notices over the plugin, for the code's errors.
- **The script brings everything else**: React, `@soundor/react`, a compiler,
  and the conversation with its parent page. Everything else about the host
  (parameters, transport, audio, the dock and the panel) works as in any build.

Embedded or not: `?embed&playground=<script>` runs the code in the bare
view.

soundor.dev's script (`apps/website/playground/`) compiles TypeScript and JSX
with Sucrase and runs the files as CommonJS modules, with `react`,
`@soundor/react` and `soundor:*` available to them; each edit unmounts the
previous UI and runs the files again. Its messages with the page are in
`apps/website/playground/protocol.ts`.

## Limitations

- The engine's WebAssembly module (`soundor-core.wasm`) comes from the
  installed `@soundor/engine`'s prebuilt release, downloaded once (about
  150 KB) into the Soundor cache when `soundor dev` or `soundor build` first
  needs it: the first run needs the network. Engine versions released before
  it had no module. See [Soundor Engine](/docs/engine#the-webassembly-core).
- Audio runs the shared Rust processor in an AudioWorklet; JUCE C++ DSP is not
  compiled for the browser.
- The host is a test bench, not a DAW: no tracks, automation lanes, MIDI or
  recording. `beginGesture()`/`endGesture()` are tracked but not recorded.
- `node.style.width = 120` changes one style property and `'120px'` lengths
  are numbers, as in the JUCE runtime (Three.js's `setSize()` writes the
  canvas's style this way).
- Images and canvases are leaves, as natively: their children are not shown.
- A canvas node is a real `<canvas>`, so its contexts are the browser's: it
  draws what browsers draw (shadows, `Path2D`, …) where the JUCE runtime's
  2D context throws. Like the JUCE runtime, it gives only '2d' and 'webgl2'
  contexts (null for other types), and their methods that take an image
  (`drawImage`, `createPattern`, `texImage2D`, …) also take canvas and image
  nodes.
- `soundor:storage` and `soundor:fs` need IndexedDB. In a browser mode that
  refuses it, their promises reject with an explanation.

## License

MIT

## Native timing animations

`UiNode.animate()` submits one animation description. The native runtime advances
its per-view C++ timeline from `RuntimeHost::tick()`; the browser uses Web
Animations. Neither requires JavaScript or React reconciliation for intermediate
opacity or transform samples. Completion promises settle on the UI thread.

```ts
const animation = view.animate(
  [
    { opacity: 0, transform: [{ translateY: 20 }] },
    { opacity: 1, transform: [{ translateY: 0 }] },
  ],
  { duration: 300, easing: 'ease-out', fill: 'forwards' },
);
await animation.finished;
```

One keyframe means a target starting from the current presentation, including a
mid-flight animation. Two keyframes specify both endpoints. Supported properties
are `opacity` and `transform`: ordered entries `translateX`, `translateY`, `scale`,
`scaleX`, `scaleY`, `rotate`, each appearing at most once. Translations use logical
pixels; rotation accepts radians as a number, or `"90deg"`/`"1.57rad"`. Transforms
compose in array order around the center of the logical border box. Explicit
endpoints must retain operation order; target changes may add/remove operations
but retain the relative order of shared operations. Logical Yoga layout remains
unchanged; hit testing, pointer offsets and accessibility bounds follow the
presented transform. Nested transforms, group opacity, clipping and overlays
retain tree stacking order.

Timing defaults: `duration: 300`, `delay: 0`, `easing: 'linear'`, `fill: 'none'`.
Duration/delay are nonnegative milliseconds. Easing also accepts `ease`,
`ease-in`, `ease-out`, `ease-in-out`; fill accepts `backwards`, `forwards`, `both`.
`pause()`, `resume()`/`play()`, `cancel()` and `finish()` control playback.
`playState` and `currentTime` are readable. `finished` resolves at completion and
rejects with `AbortError` on cancellation; replay creates a new promise.
Cancellation restores the current application style. Forward fill retains the
endpoint until cancellation or a conflicting animation. Animations never rewrite
base style. Opacity and the complete transform list are independent ownership
groups; a conflict cancels the older animation as a whole, preserving overlapping
presentation for smooth retargeting and restoring its other properties.

`setReducedMotion(true)` finishes current animations and makes new animations
instantaneous. `prefersReducedMotion()` reads the effective preference. The browser
also follows its media query unless explicitly overridden. Native embedders can
set `RuntimeHost::Options::reducedMotion`; automatic native OS preference discovery
is not yet provided.

The native compositor selectively caches animated subtrees. Intermediate
presentation frames avoid Yoga, Skia repaint and GPU uploads when content is
unchanged; CPU fallback reuses cached pixels. Canvas 2D and WebGL remain supported,
with no WebGL readback on the ordinary compatible GPU path. Cache reservation
(source pixels and composition targets) is bounded to 64 MiB with a 16384-pixel
side limit; oversized scenes use viewport CPU rendering, which may repaint and
read back WebGL. Transformed bitmap edges can differ slightly from rerasterizing
vector edges. Reported `cachedRasterBytesMax` counts CPU source pixels only;
it is not process RSS, interpreter heap size or physical GPU memory.

## Advanced animations

The same timeline and handle support springs, multiple keyframes, repetition,
seeking, composition and paint. Application base style remains independent of
presentation; cancellation restores the latest base style.

```ts
import {
  animate,
  effect,
  sequence,
  parallel,
  stagger,
  delay,
  repeat,
} from 'soundor:ui';

const spring = view.animate([{ transform: [{ scale: 0.95 }] }], {
  type: 'spring',
  stiffness: 300,
  damping: 25,
  mass: 1,
  fill: 'forwards',
});
const program = animate(
  sequence(
    [
      parallel([
        effect(panel, [{ opacity: 1 }], { duration: 200 }),
        effect(meter, [{ transform: [{ scaleY: 1 }] }], { duration: 200 }),
      ]),
      delay(100),
      stagger(
        30,
        controls.map((control) => effect(control, [{ opacity: 0.5 }])),
      ),
    ],
    { fill: 'forwards' },
  ),
);
program.pause();
program.currentTime = 150; // milliseconds from the start, including delay
program.resume();
await program.finished;
```

Spring defaults are stiffness 100, damping 10, mass 1, initial velocity 0,
rest displacement 0.001 and rest velocity 0.001. Stiffness/mass/thresholds must
be positive, including damping. Native springs evaluate the analytic
under-, critically- or overdamped solution at absolute monotonic time; they
have no integration-step drift. The duration is a conservative bound at which
both displacement and velocity envelopes meet their thresholds. A zero-damping
spring cannot settle and is rejected. Duration/easing options do not override
spring physics. Springs animate numeric opacity/transforms only. A single target
retargets from current presentation and preserves the interrupted spring's
velocity, in property units per second; explicit endpoints start with the
specified initial velocity. Clamped opacity can conceal spring overshoot.

`iterations` defaults to 1 and accepts zero, fractional counts or `Infinity`.
`direction` is `normal`, `reverse`, `alternate` or `alternate-reverse`.
`finish()` rejects an infinite animation; cancellation always works. Reduced
motion finishes one cycle of infinite effects, including phases after delays.
`currentTime` is writable, finite and nonnegative. Seeking a finished effect
backwards pauses it and creates a new completion promise; replay does likewise.
A retained promise for the prior run still settles independently.

Keyframes accept `offset` in [0,1] and per-segment standard `easing`. Offsets
must be nondecreasing; missing offsets are distributed between anchors. Missing
properties do not split another property's interpolation track. An origin
missing at offset zero comes from current presentation; the last authored
value is held through offset one. Transforms preserve relative operation order,
inserting identity values for absent operations. Keyframes are limited to 4096;
spring effects accept only an origin and target.

`sequence`, `parallel`, `stagger`, `delay` and `repeat` build descriptions once.
An effect can name a node target, or inherit the node passed to `node.animate()`.
`animate(description)` uses the view root as the default target. The native
program owns phase progression, repeats and all targets without internal JS
callbacks. Sequence origins capture preceding final values. Parallel/stagger
children must own disjoint properties on each target; opacity, the entire
transform list, background color and border color are separate ownership groups.
A conflicting animation or destruction of any target cancels the whole program
and restores its other targets. One completion promise covers the entire program;
child fill settings do not override the program's root fill behavior. Infinite
sequence phases must be last; a composition of infinite children requires normal
direction and one outer iteration. Descriptions are bounded to depth 64 and
16384 phases. Targets cannot cross runtime/view ownership.

Timing paint effects support `backgroundColor` and `borderColor`. Native colors
interpolate straight sRGB red/green/blue/alpha channels, then round to eight-bit
channels; interpolation is neither linear-light nor premultiplied. Paint uses
existing damage tracking and repaints/uploads affected content. It is not a
compositor-only optimization and does not animate Yoga layout.

Browser timing/keyframes use Web Animations directly. Springs are sampled once
at up to 240 Hz (4096 points maximum) and submitted as a native browser curve.
Composed programs compile once into per-target Web Animation curves at up to
240 Hz (16384 points per curve, one million points per segment across targets).
Long curves use coarser sampling; phase boundaries and nonlinear easing may
differ slightly from native evaluation. Browser spring retargeting uses analytic
velocity for simple effects and sampled curve velocity for composed effects.
An infinite program uses a finite prefix and a repeating common period, with
microsecond period quantization; common periods beyond one hour are rejected.
Composition colors use straight sRGB; direct browser paint interpolation follows
browser CSS color semantics, which can differ for transparency or wide-gamut
colors. No browser animation executes a JavaScript frame loop or invokes JS for
an internal phase transition. Browser completion promises remain asynchronous.

## MIDI

The host runs the project's Rust MIDI processor in AudioWorklet. Internal virtual
input needs no permission. The MIDI panel requests Web MIDI permission only when
connecting physical devices, and offers independent explicit input/output
selection according to config capabilities. Unsupported browsers and permission
denial leave virtual input available. See [MIDI](/docs/midi) for timestamp
conversion, queue limits, disconnect recovery and physical-output limitations.
