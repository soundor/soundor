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

This is not the JUCE plugin compiled for the Web. Nothing native runs in the
browser: no WebAssembly, Hermes, Yoga or Skia. The browser's own engine runs
the plugin UI, and your own TypeScript provides the native API and the audio.

## Usage

```ts
// soundor.config.ts
import { defineSoundorConfig } from '@soundor/config';
import { juceRuntime } from '@soundor/juce-runtime';
import { webRuntime } from '@soundor/web-runtime';

export default defineSoundorConfig({
  plugin: { id: 'com.example.gain', name: 'Gain' },
  runtimes: [juceRuntime(), webRuntime()],
  parameters: [
    { type: 'float', id: 'gain', label: 'Gain', min: 0, max: 1, default: 0.5 },
  ],
});
```

`webRuntime({ port })` takes one option: the port `soundor dev` serves on
(5173 by default, or the next free one).

```sh
soundor init web    # scaffold runtimes/web/ (yours; existing files are kept)
soundor dev web     # serve the Web host; edits reload the page
soundor build web   # a static site in .soundor/dist/web
soundor doctor      # Node.js, Vite, the scaffold
```

`@soundor/web-runtime` is an ordinary dependency of your project, added with
the package manager you already use. It brings Vite; the Web host has no
`package.json` or lockfile of its own.

## Lifecycle and ownership

The Web runtime follows the same five phases as the JUCE runtime, with the
same split between what you own and what Soundor regenerates.

| Phase    | What it does                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------- |
| `init`   | Writes the Web host project under `runtimes/web/`. A file that exists is never overwritten.               |
| `gen`    | Writes `.soundor/generated/runtimes/web/`, deterministically (`soundor gen --check` verifies it).         |
| `dev`    | Runs Vite's dev server on `runtimes/web/` until Ctrl+C.                                                   |
| `build`  | Runs a Vite production build into `.soundor/dist/web/`, with relative URLs.                               |
| `doctor` | Checks Node.js against what Vite needs, Vite, and the scaffold. A browser host needs no native toolchain. |

**Yours** (`runtimes/web/`, written once by `init`):

```text
runtimes/web/
├── index.html        the page
├── vite.config.ts    your Vite settings (defineWebConfig)
├── tsconfig.json     DOM and Web Audio types, plus the soundor:* declarations
└── src/
    ├── main.ts       starts the host
    ├── native.ts     your soundor:native implementation
    └── audio.ts      your Web Audio code
```

**Generated** (`.soundor/generated/runtimes/web/`, rewritten by `gen`):

- `manifest.json`: the plugin's identity, parameters and native methods.
- `native.ts`: `WebNativeApi`, the TypeScript contract `src/native.ts`
  implements.

Everything generic (the parameter store, the transport, the DOM `soundor:ui`,
storage, the host UI) lives in this package, not in generated code.

**Release output** (`.soundor/dist/web/`): the static site and nothing else.

## Vite and the plugin UI

Vite is the Web host's dev server and build system. It is not a second UI
bundler.

```text
src/main.tsx ──(soundor CLI bundler)──▶ bundle.mjs ──(Vite)──▶ browser
```

The Soundor CLI bundles the plugin UI as it does for every runtime (`bundle.js`
plus content-addressed assets) and hands it to the runtime as `ctx.ui`. Vite
loads that bundle as it is and never reads `src/main.tsx`. Vite resolves the
bundle's `soundor:*` imports to this package's browser modules.

- **In `soundor dev`,** the CLI rebuilds the bundle on every change. The page
  reloads when a new `build-id` appears, so a failed rebuild leaves the last
  working page in place. Changes under `runtimes/web/` are Vite's own and
  update as usual. The page's console and uncaught errors also appear in the
  terminal, as the JUCE plugin's do.
- **In `soundor build`,** the bundle becomes part of the production build, and
  its images are emitted under `soundor-assets/`.

`runtimes/web/vite.config.ts` is yours to extend:

```ts
import { defineWebConfig } from '@soundor/web-runtime/vite';

export default defineWebConfig({
  plugins: [/* your Vite plugins */],
});
```

The lifecycle adds Soundor's own Vite plugin to every run, whatever this file
says. That plugin fixes the root, the output directory, the relative base and
the `soundor:*` resolution, so a config cannot cut the host off from the
runtime. Running `vite` directly fails with a pointer to `soundor dev web`.

## `soundor:*` in the browser

One page (or iframe) runs one plugin, with one host context. All of these
share that context directly: the plugin UI, your `native.ts` and `audio.ts`,
and the host UI. Nothing is serialized and there is no RPC.

| Module               | In the browser                                                                                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `soundor:parameters` | One parameter store. Numbers are clamped and ints rounded, a value of the wrong type is a `TypeError`, listeners hear of changes only, and gestures nest: the JUCE runtime's semantics. |
| `soundor:host`       | `WebHost`: host name "Soundor Web", the AudioContext's sample rate, a 128-sample block, and a transport the host UI controls. Snapshots arrive every frame while playing.               |
| `soundor:ui`         | The DOM (see below).                                                                                                                                                                    |
| `soundor:native`     | Your `runtimes/web/src/native.ts`, called directly.                                                                                                                                     |
| `soundor:storage`    | IndexedDB, one database per `plugin.id`.                                                                                                                                                |
| `soundor:fs`         | A private file tree in the same database. Relative, `/`-separated paths that cannot leave it; atomic writes; the JUCE runtime's errors. The user's own files are never reachable.       |

The Web globals Soundor declares (`fetch`, timers, `URL`, `TextEncoder`,
`crypto`, `requestAnimationFrame`, …) are the browser's own.

### `soundor:ui` on the DOM

Each `UiNode` draws with one DOM element inside the plugin viewport (800×600,
the JUCE editor's size, scaled down when the page is smaller). The renderer is
`@soundor/react`'s own; there is no ReactDOM. Plugin code only ever sees
UiNodes.

- **Layout.** A stylesheet gives the DOM Yoga's defaults: flex columns that do
  not shrink, border-box sizes, no automatic minimum sizes, and text that
  inherits nothing. `flex` is read as React Native reads it, and invalid
  styles fail with the JUCE runtime's messages.
- **Events.** Events capture and bubble along the Soundor tree, and input
  follows the JUCE runtime's rules: implicit pointer capture, hover enter and
  leave along the tree, a click to the deepest node holding both press and
  release, focus on press, Tab cycling, and the wheel scrolling the nearest
  scroll view. All four `pointerEvents` modes work.
- **Text inputs** edit natively (IME, selection, copy and paste) and report
  `beforeinput`, `input` and `change`.
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
  hidden DOM, and no AccessKit. The JUCE runtime's semantic rules decide
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
    is never delivered twice. Other actions have no DOM path: screen
    readers adjust sliders with the arrow keys, which a control handles
    itself.

## Native API in TypeScript

The config's `native` section declares the API. `gen` turns it into
`WebNativeApi`, and `runtimes/web/src/native.ts` implements it:

```ts
// soundor.config.ts
native: {
  types: { Preset: 'handle', Analysis: { struct: { rms: 'number' } } },
  methods: {
    analyze: { args: { samples: 'Float32Array' }, returns: 'Analysis' },
    loadPreset: { args: { path: 'string' }, returns: 'Preset', async: true },
  },
},
```

```ts
// runtimes/web/src/native.ts
import {
  Preset,
  type WebNativeApi,
} from '../../../.soundor/generated/runtimes/web/native';

export const native: WebNativeApi = {
  analyze(samples) {
    const sum = samples.reduce((total, x) => total + x * x, 0);
    return { rms: Math.sqrt(sum / samples.length) };
  },
  async loadPreset(path) {
    const response = await fetch(path);
    return Preset.wrap(await response.json());
  },
};
```

- A method added to the config is a type error in `native.ts` until you
  implement it. At startup the host also rejects an implementation that
  misses methods, naming them.
- The plugin's `import { analyze } from 'soundor:native'` calls your function
  directly. Typed arrays arrive as the same objects, exceptions stay
  exceptions, and an async method always returns a promise.
- Handles are opaque: `Preset.wrap(value)` makes one, `Preset.unwrap(handle)`
  gets the value back, and anything else is rejected.

## Audio: raw Web Audio

The Web runtime has no Soundor DSP. Your `runtimes/web/src/audio.ts` connects
plain Web Audio nodes between the host's input and output buses:

```ts
import type { WebAudioSetup } from '@soundor/web-runtime/client';
import { parameters } from 'soundor:parameters';

export const setupAudio: WebAudioSetup = ({ context, input, output }) => {
  const gain = context.createGain();
  gain.gain.value = parameters.gain.get();
  const unsubscribe = parameters.gain.subscribe((value) =>
    gain.gain.setTargetAtTime(value, context.currentTime, 0.01),
  );
  input.connect(gain);
  gain.connect(output);
  return () => {
    unsubscribe();
    input.disconnect();
    gain.disconnect();
  };
};
```

```text
source → input bus → setupAudio's nodes → output bus → master gain → speakers
```

- The host owns one AudioContext. Browsers allow audio only after a user
  gesture, so the host creates the context on the page's first one, wherever
  it is: a click or key on the plugin, Play, any host control.
- Without an `audio.ts`, or when it throws, the input passes straight through,
  and the panel's Audio section says why.
- `soundor:parameters` and `soundor:host` work in `audio.ts` too. The `gain`
  above is the same parameter the plugin UI moves.

## The host UI

The plugin is the page. Its view keeps the JUCE editor's size (800×600) and
is scaled down, never up, when the page is smaller (an iframe in docs, a
phone, the panel open). The host stays out of its way:

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
  input source (an oscillator, an audio file of yours, or no input; a source
  plays while the transport does), the audio format and status; and a control
  per parameter, moving the same values the plugin does. The transport drives
  the same `WebHost` that `soundor:host` reports to the plugin; the plugin
  observes the transport and never controls it.
- **Presentations:** `soundor dev` (the `dev` presentation) adds the host
  state to the panel and remembers whether the panel was open. A build shows
  the `demo` presentation. `startSoundorWebHost({ presentation })` overrides
  either default.

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

soundor.dev's script (`apps/website/playground/`) compiles TypeScript and JSX
with Sucrase and runs the files as CommonJS modules, with `react`,
`@soundor/react` and `soundor:*` available to them; each edit unmounts the
previous UI and runs the files again. Its messages with the page are in
`apps/website/playground/protocol.ts`.

## Limitations

- No DSP abstraction. Audio is your own Web Audio code; there is no portable
  Soundor DSP, no AudioWorklet layer, and no compiling of the JUCE DSP to
  WebAssembly.
- The host is a test bench, not a DAW: no tracks, automation lanes, MIDI or
  recording. `beginGesture()`/`endGesture()` are tracked but not recorded.
- No microphone input yet.
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

## Post-MVP direction

Planned, but not part of this runtime yet:

- A portable Soundor DSP description, so one DSP source runs natively and in
  the browser (on an AudioWorklet).
- Host automation and MIDI.
- A control protocol between a docs page and an embedded plugin.

Until then, the Web runtime uses the audio code you write for it.

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
