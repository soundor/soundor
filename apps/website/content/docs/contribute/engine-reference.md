---
title: 'Engine reference'
description: 'Embedding API, JavaScript language support, modules, graphics, accessibility, dependencies, symbol isolation, builds, and animation contracts.'
---

Source: [`runtimes/engine/`](https://github.com/soundor/soundor/tree/main/runtimes/engine).

The independently versioned C++ engine owns the native UI runtime, its public
headers, embedded resources and dependency recipes. JUCE integration lives in
`@soundor/juce-runtime`; JUCE itself is not included here.

The engine owns the Hermes module-lowering tool, re-exported by `@soundor/core`.
Engine is outside the fixed Changesets group and does not depend on core.
Ordinary core releases therefore do not force an engine release. The ordinary
package build compiles this small JavaScript tool only, never native libraries.

Consumers `add_subdirectory()` the installed engine package and link
`Soundor::Engine`, built from its sources (`SOUNDOR_ENGINE_MODE=source`) or
taken from its verified prebuilt release (`prebuilt`, the JUCE runtime's
default; see [Prebuilt engines](#prebuilt-engines) and
[Soundor Engine](/docs/engine)). JUCE resolves that package normally,
so pnpm workspace source changes are immediately available to source-mode
plugin builds.

## Native runtime

The C++ side of Soundor's embedded JavaScript runtime: the engine that runs
a plugin's UI JavaScript on the UI/message thread. DSP stays native and never
touches JavaScript.

This library is **backend-independent**: it does not include JUCE, so it builds
and tests without a plugin host. JUCE adapters live in separate targets in
`runtimes/juce-runtime/native/backend/juce/`.

Each plugin view loads its UI bundle into a separate runtime. Development loads
source for reloading; production embeds compiled Hermes bytecode. The engine
provides layout, rendering, accessibility, the Web platform layer, and the
`soundor:*` modules.

## Development inspection

`SOUNDOR_ENABLE_DEVTOOLS` defaults to OFF. Native development/test presets enable
it only for Debug; release configurations compile `SOUNDOR_DEVTOOLS=0` and plugin
production builds force it off. `debug::Inspector` accepts plain protocol
commands on the owning thread, reading the actual `RuntimeHost`/`Surface` without
retaining either across generations. It exposes bounded snapshots of both UI
roots, relevant normalized style/presentation data, layout, text, visibility,
focus and the existing semantic tree. Semantic inspection preserves pending
platform accessibility updates.

Full snapshots are on demand and bounded to 5000 nodes and a transport budget,
with truncation reported. Subscribed revision notifications are coalesced to
10 Hz. Structure changes invalidate the tree; text/role/name changes include
bounded metadata patches (up to 128 nodes/200 KB). Geometry-only changes do not
serialize the full tree. Metadata capture is inactive without subscribers.
Computed styles beyond stored normalized inputs and presentation values are
not invented. Source component/file information and property overrides are
not available from arbitrary native nodes.

Native diagnostics reuse the real `AnimationTimeline` and existing host, surface,
frame and compositor counters. Animation capture is subscription-driven, with
bounded lifecycle queues and on-demand active snapshots. `Inspector::renderFrame`
wraps the normal frame/composition path only during explicit recording. Node paint
clocks are enabled only then; no new instrumentation touches audio callbacks.
Recordings sample at up to 10 Hz and retain 300 samples. Reset clears recording
state on lease loss, disconnect and reload; picker cancellation alone preserves
an active recording. Stopping explicitly preserves the current samples.

Frame timing measures CPU production/submission work, not GPU execution. Existing
UI tick phases expose dispatch work, not total Hermes execution time. Delayed UI
tick intervals are not claimed as dropped GPU frames. See the
[protocol measurement contract](/docs/contribute/devtools-protocol#animation-and-performance-data)
for fields, limits, read-only property inspection and source metadata limitations.

Picker interception precedes normal event routing: active capture is cancelled,
selection press/release and Escape are consumed, and suppressed releases remain
suppressed after a disconnect or reload. Hit testing uses the engine's real
stacking, portals, scrolling and transforms. Highlighting stores only a scoped
node ID on the surface, not a UI node or a style override. `render::DebugOverlay`
appends a Skia raster layer after normal content for CPU or GPU composition,
with ancestor clipping and world transforms. Static highlights keep their
rasterization even when unrelated UI styles change; no WebGL readback is added.

The JUCE adapter supplies authenticated asynchronous HTTP IPC on worker threads;
it reads a protected descriptor provided by the launcher, never discovers ports.
Commands carry a server-stamped target generation, including commands without
node references. Cancellation removes queued work; host replacement rejects
old-generation commands. Network results contain no JSI values or native node
references. Worker failures cannot perform engine mutations or stop audio.

From `runtimes/juce-runtime/native/`, `cmake --preset juce`, then the JUCE build/test presets,
add a headless real-engine test against the actual Node server. It covers tree
and accessibility details, highlighting, Canvas picking without application
events, host replacement, disconnection, protected session handoff and bounded
worker teardown. Actual cross-window interaction still needs a graphical desktop.

The JUCE `soundor_debug_session` test also has optional real-browser coverage.
With Playwright and its Chromium already installed, run from
`runtimes/juce-runtime/native/`:

```sh
SOUNDOR_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs ctest --test-dir build/juce -R soundor_debug_session --output-on-failure
```

This exercises the shipped inspector against the real headless native bridge:
native picker synchronization, control ownership across tabs, runtime reload and
mapped logs. It does not replace manual native-window overlay validation.
`SOUNDOR_DEVTOOLS_SCREENSHOT=/tmp/inspector.png` optionally saves the browser view.
The normal test workflow has no browser dependency and downloads no browser.

## Layout

```text
runtimes/engine/
  include/soundor/        public headers: plain C++, no engine types
    Config.h              the ABI namespace (see "Symbol isolation")
    a11y/                 accessibility semantics and the semantic tree
    js/                   Runtime, Context, Value, Error, ModuleLoader, Promise
    parameters/           the parameter Host interface backends implement
    platform/             HttpClient and HostInfo, the services backends provide
    render/               frames, layers, damage regions and the Compositor
                          interface (no Skia or GPU types)
    runtime/              RuntimeHost: one plugin view's JavaScript world
    ui/                   the node tree (Surface), styles, text, the renderer
  src/
    a11y/                 the semantic tree of a ui::Surface
    js/                   the Hermes (JSI) wrapper, the module system and the
                          binding helpers generated code uses; the only place
                          Hermes's headers are included
    modules/              soundor:* modules (C++, plus embedded JavaScript)
    gpu/                  ANGLE: GPU devices and OpenGL ES contexts, the GPU
                          compositor, WebGL (webgl/); the only place its
                          headers are included
    platform/             background worker and UI-thread handoff queue
    render/               Skia: drawing nodes, damage tracking, layer planning,
                          the CPU compositor
    runtime/              RuntimeHost
    ui/                   the Surface (Yoga layout, input routing)
    web/                  the Web-compatible globals (C++ + embedded JavaScript)
  # JUCE adapters are in ../juce-runtime/native/backend/juce
  tests/                  doctest suites + the exported-symbol check
    generated/            golden soundor:native output, compiled by the tests
  cmake/                  pinned dependencies, compiler policy, JS embedding,
    hermes/               building Hermes: the project, Soundor's additions
    angle/                building ANGLE: DEPS checkout, gn → CMake, its project
```

A third-party header (Hermes, Yoga, Skia) is only included by the directory
that wraps it.

## Embedding API

```cpp
#include <soundor/js/Context.h>

soundor::js::Runtime runtime({ .log = [](auto level, auto message) { /* ... */ } });

auto loader = std::make_shared<soundor::js::MemoryModuleLoader>();
loader->add("/app/main.js", bundleSource);

soundor::js::Context context(runtime, { .moduleLoader = loader });
if (auto result = context.importModule("/app/main.js"); ! result)
    report(result.error().toString(), result.error().stack);

// Then, from the UI thread's event loop:
runtime.runPendingJobs();
```

- **Runtime**: the engine's options (memory and stack limits, the log sink)
  and statistics for a set of contexts.
- **Context**: one realm (global object and module map) in a Hermes runtime of
  its own: its heap and job queue. A new context contains the ECMAScript
  language and nothing else. There is no `console`, timers, `window`, `self`,
  `process`, global `require`, `performance` or `atob`, and none of Hermes's
  host functions (`print`, `gc`, its `TextEncoder`). The Web platform layer
  installs a deliberate subset later.
- **Errors**: JavaScript exceptions come back as `Result<T>` holding a
  `soundor::js::Error` (`name`, `message`, `stack`: the frames). Inside, JSI's
  `jsi::JSError` is the way native code throws into JavaScript; any other C++
  exception (from a module loader or native-module code) stops at the binding
  (`bind::invoke`) and becomes a JavaScript error, so none other reaches the
  engine.
- **Jobs**: promise jobs run only when `Runtime::runPendingJobs()` is called. After
  the queue drains, rejections nobody handled are reported to the log sink,
  and FinalizationRegistry callbacks of collected objects run.
  `evaluateModule` drains jobs itself, so top-level `await` settles.
- **Memory**: a context that runs out of its heap (`RuntimeOptions::memoryLimit`)
  fails that call, and every later one, with an `out of memory` InternalError
  instead of taking the host down: Hermes cannot go on in that heap, so the
  context has to be recreated (a reload).
- **Time**: a call into JavaScript that runs longer than
  `RuntimeOptions::timeLimit` (0, the default: no limit; the generated editor
  sets `juceRuntime({ timeLimit })`, 5 s by default) is stopped by the engine
  with a `TimeoutError` JavaScript cannot catch: it fails with that error and
  its stack, and so does every later call, as after running out of memory (a
  script stopped anywhere may have left its state half updated). The clock
  starts at the outermost call into JavaScript (a script, a module, a job
  drain, a callback, an event listener), not again for JavaScript that native
  code it called calls back; `js::TimeLimitScope` makes several calls share
  one deadline, as `RuntimeHost::tick()` does for a tick and
  `performAccessibilityAction()` for an action. The engine checks the time at
  loop back-edges and function entries, in source as in bytecode (which
  hermesc compiles with `-emit-async-break-check`). It cannot stop native
  code, but the clock runs on while native code does: a native call that
  takes longer than the limit has its script stopped as soon as it returns.

### The JavaScript engine

Hermes (`cmake/SoundorHermes.cmake`), interpreted: no JIT and no Static
Hermes. It is built from source once per machine into Soundor's cache by its
own CMake (`cmake/hermes/`): the VM and its JSI API, without the debugger,
inspector or Intl, with hidden symbols, position-independent, and throwing
`JSOutOfMemoryError` on a full heap instead of aborting. Two VMs come out of
it:

- **with the compiler** (`soundor_hermes_full`), which also evaluates
  JavaScript source: what `soundor dev` (it reloads the UI's source), the
  tests and `soundor_run_ui` link (`SOUNDOR_JS_SOURCE=ON`, the default);
- **without it** (`soundor_hermes_lean`), bytecode only: what a production
  plugin links (the generated `setup.cmake` sets `SOUNDOR_JS_SOURCE=OFF`).

`hermesc`, the bytecode compiler, is a build tool of the same build and is
never linked into a plugin. Soundor's additions to Hermes (`cmake/hermes/`,
applied by `SoundorHermesPatch.cmake`, which fails when Hermes's code changed
under them) give the bindings exact typed-array views (by internal class, with
their offset and length, in one call), the job queue's state and the
collector's counters (`SoundorHermes.h`). On Linux, Hermes's Unicode (case
mapping, normalization, `localeCompare`, `toLocaleString`) comes from
QuickJS-NG's tables instead of the system's ICU, which a plugin cannot rely on
(`cmake/hermes/PlatformUnicodeLite.cpp`), and knows no locale:
`localeCompare` compares the code points of the NFC forms (`'B'` sorts before
`'a'`), and a date's `toLocaleString()` is always `MM/DD/YYYY, hh:mm:ss AM`
in local time. A browser follows the user's locale, and so should Hermes's
own implementations on macOS (CoreFoundation) and Windows, not tested yet.

What Hermes lacks of what the language offered before is completed by
`soundor:internal/language` (`src/js/language.js`), which every context
evaluates first: FinalizationRegistry (on the engine's finalizers),
`queueMicrotask`, `Symbol.asyncIterator`, `Promise.withResolvers`/`try`,
`Array.fromAsync`, `toSorted` and the TypedArray copies, `Object`/`Map.groupBy`,
the Set methods, `isWellFormed`/`toWellFormed`, `Error.isError`, the Iterator
helpers and ArrayBuffer's `transfer()`/`detached`. Still missing: Atomics and
SharedArrayBuffer, Float16Array, `Symbol.species`, resizable ArrayBuffers,
`Intl`, Iterator's newest helpers (`chunks`, `zip`...).

JavaScript compiles no source: `eval()`, `Function()` and the generator and
async function constructors throw `SyntaxError: Parsing source code
unsupported`. A production plugin's VM has no compiler to do it, and
development fails the same way instead of working until the plugin is built
(the context turns eval off, with the compiler linked too). Code generated at
run time needs a form made at build time: schema validators' standalone code
(ajv's `standalone`), precompiled templates. `setTimeout` and `setInterval`
reject strings likewise.

The host still compiles source where the compiler is linked
(`Context::evaluateScript`, `evaluateModule`: development and the tests). That
is what Hermes compiles itself, with block scoping: no classes (Hermes's
experimental ones lose `super(message)` when extending Error) and no async
arrow functions; top-level `let`/`const` belong to their script. Modules are
lowered for it beforehand instead (below).

### Modules

Hermes has no ES modules. A module's file is a script whose value is its
module function: `(function (exports, require, module) { ... })`, or an
`async` one when it awaits at top level. The context calls it with a
`require` that resolves as below, the module's `exports`, and `module`
(`{ exports, id, meta: { url } }`); `import()` becomes a promise of a
`require`, `import.meta` is `module.meta`. A module is recorded before it
runs, so a cycle sees the exports made so far, as CommonJS does; `require()`
is synchronous, so only an entry module may await at top level.

`@soundor/core`'s `toNativeModule()` makes this form from an ES module with
Babel, lowering the syntax Hermes compiles only experimentally or not at
all: classes (their fields, private members and static blocks), `let`/`const`
block scoping, async functions and generators (into generators) and
`for await`. Private members become properties keyed by symbols of their own,
unchecked: much faster in the interpreter than the spec's WeakMaps, but
visible to `Object.getOwnPropertySymbols()`, and reading one on an object
without it gives `undefined` instead of throwing a TypeError. `let` and
`const` become `var` without their temporal dead zone: a variable read before
its declaration is `undefined`, where an engine running the ES module (the
Web runtime) throws a ReferenceError. The CLI makes a plugin's bundle
so (`bundle.js`); the runtime's own modules (`src/**/*.js`) are lowered
while building, into the build directory (`soundor_embed_module()`, with
`cmake/SoundorLowerJs.mjs`), each statement on the line it has in `src/`, so
that their stack traces point at the module as written. So a native build
needs Node, with this repository's or a plugin project's dependencies
installed: `SOUNDOR_NODE_EXE`, or the `node` on PATH (plugin builds pass the
one running the CLI).

Soundor resolves every `require`; the engine never touches the filesystem.

- `soundor:*` specifiers are reserved for runtime-provided native modules. They
  resolve inside the `Context` and never reach the loader. An unregistered one
  fails with `Unknown Soundor module`.
- Everything else goes to the context's `ModuleLoader`. The built-in
  `MemoryModuleLoader` serves a bundled plugin. It resolves relative and absolute
  paths and rejects bare specifiers (`react`, `node:fs`), because npm packages
  are bundled at build time, not resolved at runtime.

Native modules use a private registration API (`src/js/NativeModule.h`), and
generated bindings are written against the helpers in `src/js/Bindings.h`.

### Bytecode

JavaScript is compiled to Hermes bytecode while building, by the `hermesc` of
the same Hermes build as the VM, with `-O -fno-inline` (`SOUNDOR_HERMESC_FLAGS`;
`SoundorCompileJs.cmake`) and always the checks the time limit needs
(`-emit-async-break-check`): the runtime's own modules (`soundor_embed_module()`)
and a plugin's UI bundle (`soundor_embed_ui()`, used by the generated plugin
project). The engine then runs the bytecode in place instead of compiling
source.

- **Names and lines:** the module's name ("/bundle.js", "soundor:ui") is its
  file name in stack traces (a `sourceURL` comment); the bytecode keeps line
  and column numbers, not the source. Without `-fno-inline`, `-O` would inline
  small functions and drop their frames from stack traces; measured with
  `tools/benchmark`, inlining saved no time.
- **Only from the build:** Hermes runs bytecode without defending against a
  hostile writer, so only bytecode compiled into the binary is read
  (`Resources::builtIn()`): a UI in a directory (`soundor dev`) is always
  read as source. The bytecode ends with an epilogue naming the Hermes
  revision (`src/js/Bytecode.h`); another revision's is refused with an error,
  and Hermes itself refuses another bytecode version. Both LF and Windows
  CRLF marker line endings are accepted; the revision must still match exactly.
- **Where the build cannot run hermesc** (cross-compiling), or with
  `-DSOUNDOR_PRECOMPILE_JS=OFF`, source is embedded instead, and the VM with
  the compiler is needed.
- **Loaders:** `ModuleLoader::loadBytecode()` (none by default) offers a
  module's bytecode; `ResourceModuleLoader` finds `bundle.js.hbc` next to
  `bundle.js` in built-in resources.
- `build/<preset>/soundor-compile-js.cmake` compiles a module as the build
  does: `cmake -DINPUT=bundle.js -DOUTPUT=bundle.js.hbc -DNAME=/bundle.js -P …`.

### `soundor:native`

The JUCE runtime's `gen` turns the config's `native` API into a C++ interface
(`soundor::native::NativeApi`) plus bindings. The plugin implements the
interface and installs it into each context:

```cpp
#include <soundor/native/SoundorNative.h>

class Api final : public soundor::native::NativeApi
{
    soundor::native::Analysis analyze(std::span<const float> samples) override;
    void loadPreset(std::string path, soundor::js::Promise<std::shared_ptr<soundor::native::Preset>> promise) override;
};

soundor::native::install(context, std::make_shared<Api>());
```

- **Validation.** Every argument is type-checked before C++ runs, and a mismatch
  is a `TypeError` naming the path, e.g. `centroid(): points[1].y: expected
  number, got undefined`. Missing arguments are errors; extra ones are ignored,
  as for any JavaScript function.
- **Binary data.** Typed-array and `ArrayBuffer` arguments arrive as read-only
  `std::span`s into the JavaScript buffer: zero-copy, valid until the method
  returns. Returned `std::vector`s move into JavaScript-owned buffers without a
  copy.
- **Handles.** Native objects cross as opaque JavaScript objects backed by a
  `std::shared_ptr` (in the object's JSI native state). They cannot be forged
  or confused between types. The C++ object is released on the runtime's
  thread: at the next job drain (the next tick) after the garbage collector
  finalizes the handle, and at the latest when its context is destroyed, so
  its destructor never runs on the collector's thread.
- **Errors.** A C++ exception from a method becomes a JavaScript `Error`
  (`"fail(): disk full"`); only `jsi::JSError`, JSI's own, reaches the engine.
- **Async.** `async` methods receive a `js::Promise<T>` to settle later, on the
  runtime's thread. The first settle wins. A promise dropped unsettled rejects,
  and settling after the context is gone does nothing.

The generator's output for a fixture covering every type is checked in under
`tests/generated` and compiled by the native tests. A TypeScript test fails if
it ever drifts from the generator (`UPDATE_GOLDEN=1 pnpm --filter
@soundor/juce-runtime test` regenerates it).

### `soundor:parameters`

The config's parameters as typed objects, shared with the DSP and the host:

```ts
import { parameters } from 'soundor:parameters';

parameters.gain.get(); // number, in the declared range
parameters.mode.set('stereo'); // enums are their string values
const stop = parameters.gain.subscribe((gain) => draw(gain));
parameters.gain.beginGesture(); // ...set()s while dragging... endGesture()
parameters.gain.info; // { id, label, type, min, max, default, unit }
```

- **One parameter store.** A backend implements `parameters::Host` over its own
  parameter system: `JuceParameterHost` wraps the `AudioProcessorValueTreeState`.
  Values pass in plain units; `set()` validates the JavaScript type, then clamps
  (and rounds, for discrete kinds).
- **Realtime-safe change propagation.** Backend listeners, which may run on the
  audio thread, only set a lock-free `ChangeFlags` bit. On the UI thread,
  `RuntimeHost::tick()` drains the flags and calls each changed parameter's
  subscribers once, with the latest value; bursts coalesce. JavaScript never
  polls, and nothing runs JavaScript off the UI thread.
- **Lifetimes.** Subscriber lists live in JavaScript and die with the context,
  so reloads cannot accumulate listeners. Nested gestures reach the host as one
  gesture, an unmatched `endGesture()` is ignored, and a gesture still open when
  the runtime is destroyed (a reload mid-drag) is ended.
- The module's JavaScript layer (`src/modules/parameters/parameters.js`) is
  embedded at build time. It uses `soundor:internal/parameters`, which only
  runtime modules may import.

### The Web platform layer

`RuntimeHost` installs a deliberate subset of Web APIs. These are the ones a
standard already solves a generic problem with; Soundor never pretends to be a
browser or Node. There is no `window`, `document`, `process` or `require`.

| Globals                                                                | Notes                                                                                                                                                                                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `globalThis`, `self`                                                   | `self === globalThis`                                                                                                                                                                                         |
| `console`                                                              | log/info/debug/warn/error, trace, assert, group, count, time; printf-style `%s %d %i %f %j %o %O`; objects formatted like Node's `util.inspect`. Goes to the runtime's log sink (the `soundor dev` terminal). |
| `setTimeout`, `setInterval`, `clear*`, `queueMicrotask`, `reportError` | Timers fire from `RuntimeHost::tick()`, so they have frame resolution. String callbacks are rejected (no implied eval).                                                                                       |
| `performance.now()`, `performance.timeOrigin`                          | The same monotonic clock as the timers.                                                                                                                                                                       |
| `Event`, `CustomEvent`, `EventTarget`                                  | The DOM event model without a tree: target-only dispatch, `once`/`signal`/`passive`, listener errors reported.                                                                                                |
| `AbortController`, `AbortSignal`                                       | Including `abort()`, `timeout()` and `any()`.                                                                                                                                                                 |
| `TextEncoder`, `TextDecoder`                                           | WHATWG UTF-8, with streaming and `fatal`.                                                                                                                                                                     |
| `URL`, `URLSearchParams`                                               | WHATWG URL via [ada](https://github.com/ada-url/ada), including IDNA.                                                                                                                                         |
| `atob`, `btoa`, `DOMException`                                         | `src/web/js/base64.js`, `src/web/js/dom-exception.js`.                                                                                                                                                        |
| `structuredClone`                                                      | Including `transfer`. Functions, symbols and similar values throw `DataCloneError`.                                                                                                                           |
| `crypto.getRandomValues()`, `crypto.randomUUID()`                      | From the OS CSPRNG. `crypto.subtle` is not provided.                                                                                                                                                          |
| `fetch`, `Headers`, `Request`, `Response`, `Blob`, `File`, `FormData`  | Through the backend's `HttpClient`. Bodies are buffered (no Web Streams yet). `data:` URLs resolve locally; redirects are always followed.                                                                    |

Not provided: the DOM (canvas contexts come with `soundor:ui`'s canvas
nodes), Workers, IndexedDB/`localStorage`,
`XMLHttpRequest`, WebSocket, Web Streams, WebAudio.

Anything that would block, such as network or file I/O, is asynchronous. Work
runs on backend or worker threads and carries only an operation id and plain
C++ results back. The UI thread settles the promise in `tick()`. A runtime torn
down mid-operation is therefore safe: in-flight requests are cancelled, file
writes already started complete, and late results are dropped.

### `soundor:host`, `soundor:storage`, `soundor:fs`

```ts
import { readText, writeText } from 'soundor:fs';
import { plugin, snapshot, subscribe } from 'soundor:host';
import { storage } from 'soundor:storage';

subscribe(({ transport }) => drawPlayhead(transport?.ppqPosition));
await storage.set('lastPreset', 'warm');
await writeText('presets/warm.json', JSON.stringify(preset));
```

- **`soundor:host`:** the plugin's id and name, plus host snapshots (sample
  rate, block size, host name, transport). The backend captures the transport
  on the audio thread without locking. Subscribers receive each changed
  snapshot, once per frame while playing.
- **`soundor:storage`:** persistent JSON key/value storage in
  `<data>/storage.json`. It is private to the plugin and safe across instances
  in one process.
- **`soundor:fs`:** asynchronous file access confined to `<data>/files`. Paths
  are relative; `..`, absolute paths and symlinks leading outside are refused.
  Writes are atomic. Errors are `DOMException`s (`NotFoundError`,
  `NotAllowedError`, …).

`<data>` is the plugin's private data directory, chosen by the backend (JUCE:
`<user application data>/Soundor/<plugin.id>`).

### `soundor:ui`

The plugin view is a tree of nodes, laid out with flexbox
([Yoga](https://www.yogalayout.dev)), with DOM-style events.

```ts
import { root, createView, createText } from 'soundor:ui';

const knob = createView({ width: 48, height: 48, margin: 8 });
knob.focusable = true;
knob.addEventListener('pointerdown', (event) => startDrag(event.clientY));
knob.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowUp') (nudge(+1), event.preventDefault());
});
root.style = { flexDirection: 'row', alignItems: 'center', padding: 12 };
root.appendChild(knob);
root.appendChild(createText('Gain', { fontSize: 13 }));
```

- **Nodes:** `UiNode`s are `'view'` boxes or `'text'` runs. They are
  `EventTarget`s with `appendChild`, `insertBefore`, `removeChild`, `style`,
  `layout` (box relative to the parent) and `getBoundingClientRect()`. A
  detached node that nothing references is released, natively too, when it is
  garbage-collected.
- **Style:** React Native's flexbox: column by default, `flex: n`, the margin,
  padding and border shorthands, percentages, absolute positioning, gaps,
  `pointerEvents`, and the text properties used to measure text. Lengths are
  numbers (logical pixels), CSS pixels (`'120px'`, kept as the number) or
  percentages. An invalid value throws a `TypeError` naming the property.
  `node.style = {…}` replaces the style. `node.style.width = 120` changes one
  property, as on the Web; `''`, `null` or `delete` removes it.
- **Restyling costs what changed:** assigning what a style already is does
  not reach native code. A change that only looks different (colors, border
  radius, opacity, text color, `pointerEvents`, `zIndex`) is drawn again but
  not laid out; text is measured again only when its font changes.
- **Input:** the backend hands `ui::Surface` normalized input (`ui/Input.h`).
  Positions are in logical pixels, and buttons and keys use their Web names.
  The surface routes the input:
  - **Hit testing:** later siblings sit on top; `overflow` clips;
    `pointerEvents` applies.
  - **Pointer capture:** implicit from press to release.
  - **Hover:** `pointerenter`/`pointerleave`.
  - **Clicks:** a `click` goes to the deepest node common to press and release.
  - **Focus:** a press focuses the nearest `focusable` node unless
    `pointerdown` is prevented. Tab and Shift+Tab cycle through focusable
    nodes.
  - **Keys and text:** `keydown`/`keyup` go to the focused node (else the
    root). Typed text arrives as `beforeinput`.
- **Events:** capture and bubble as in the DOM, as `PointerEvent`,
  `WheelEvent`, `KeyboardEvent`, `FocusEvent` and `InputEvent`.
  `preventDefault()` tells the backend the input was handled; unhandled keys
  and wheel input go on to the host.
  At the target, capture listeners run before bubble listeners.
  `stopPropagation()` prevents visiting other nodes while allowing the remaining
  listeners on that target; `stopImmediatePropagation()` stops those listeners
  too. `preventDefault()` independently prevents the runtime's default action.

Beyond views and text there are the primitives a plugin UI is made of:

- **`createImage(asset, style)`:** a bundled image (PNG, JPEG or WebP). It is
  sized by its pixels unless styled; `resizeMode` is `cover`, `contain`,
  `stretch` or `center`.
  Decoding makes its mipmaps once, and it is drawn between the two nearest:
  an image drawn much smaller than its pixels averages them, not aliasing.
- **`createScrollView(style)`:** its children scroll by wheel or by `scrollTo()`
  and `scrollTop`/`scrollLeft`. It fires `scroll`, clips, and draws thin scroll
  indicators.
- **`createTextInput({ value, placeholder, style })`:** a focusable, single-line
  input.
  - **Editing:** it edits itself as the default action of its events, so a
    listener's `preventDefault()` takes over. That covers typing, selection
    with the mouse and Shift, word-wise moves and deletes, Home/End, and
    copy/cut/paste through the system clipboard.
  - **Events:** it fires `input`, and `change` on Enter and on blur.
  - **Selection:** `value`, `selectionStart` and `setSelectionRange()` use
    UTF-16 indices, as on the Web.
- **`createCanvas(style)`:** pixels code draws, like an HTML `<canvas>`.
  - **Size:** `width` and `height` are the drawing buffer's (300 by 150 to
    begin with); setting either clears it and resets its context, even to the
    same value. The node's box is that size in logical pixels unless styled,
    and the pixels are stretched over it; size the buffer by
    `devicePixelRatio` (a global) for crisp lines.
  - **`getContext('2d')`:** a `CanvasRenderingContext2D` drawn with Skia on
    the CPU (`src/render/Canvas2D.cpp`), the same object every time; other
    types give null, as on the Web for a canvas that already has a
    context. The JavaScript side (`canvas.js`) converts arguments as WebIDL
    does and makes one native call per method, except for path commands
    (`beginPath` through `ellipse`, not `roundRect`): they draw nothing by
    themselves, so they are checked as they are made, gathered in a
    `Float64Array` and sent in one call before whatever comes next (or once
    65,536 numbers wait). Resizing the canvas drops those not sent, with the
    path. A waveform of 10,000 points is 7 native calls a frame, not 10,007.
  - **What it draws:** state (`save`/`restore`/`reset`, `globalAlpha`, every
    `globalCompositeOperation`), transforms, rectangles, paths (lines, curves,
    `arc`, `arcTo`, `ellipse`, `rect`, `roundRect`; `fill`, `stroke`, `clip`
    with either fill rule; `isPointInPath`/`isPointInStroke`), line styles
    and dashes, colors, linear, radial and conic gradients, patterns of a
    canvas, text (`font` shorthand, `textAlign`, `textBaseline`, `fillText`,
    `strokeText`, `measureText`: width and the font's ascent and descent),
    `drawImage` of a canvas or an image node, and `ImageData`
    (`createImageData`, `getImageData`, `putImageData`).
  - **What it does not:** shadows, `filter`, `Path2D`, `DOMMatrix`
    (`getTransform()` is a plain `{ a, b, c, d, e, f }`), `alpha: false`, and
    other `direction`s than `ltr`. They throw a `TypeError` saying so (only
    their default values are accepted), never draw something else.
  - **Rendering:** a canvas is drawn into the UI's layer; drawing marks only
    its box as changed.
  - **`getContext('webgl2')`:** a `WebGL2RenderingContext` on the GPU (see
    "WebGL"), or null where there is no acceptable GPU. `getContext('webgl')`
    (WebGL 1) is null.
- **`pressable(node, { onPress, onStateChange, … })`:** a press is a primary
  click, Enter/Space while focused, or an `activate` accessibility action. It
  reports pressed and hovered state.
- **`requestAnimationFrame()`:** global, as on the Web. Callbacks run once on
  the view's next frame, before it is drawn.

### Rendering

A frame goes through three stages, each with its own owner:

1. **Planning and rasterizing (the runtime).** `RuntimeHost::frame()` lays the
   surface out and returns a `render::Frame`: the view's size and its
   _layers_, bottom to top. A layer is content placed at device-pixel
   `bounds`, with a `transform`, `opacity` and rounded `clip`, and a stable
   `id` while it exists. The content is either CPU pixels (a
   `render::RasterSurface`) or a `render::GpuImage` drawn elsewhere (a WebGL
   canvas). The UI (content and overlay) is one CPU layer. A WebGL canvas the
   compositor can draw (see "WebGL") becomes a layer of its own, and the UI
   is cut around it, into what paints before it and what paints after. So a
   canvas drawing every frame re-rasterizes and re-uploads none of the UI.
   Damage is split the same way: a change to what paints above a canvas
   redraws only the layer above it, and only there. A CPU layer that paints
   nothing (often the one above a canvas) is left out of the frame.
   `frame(capabilities)` takes the compositor's capabilities to know which
   GPU images it can draw.
2. **Damage.** Each layer says what changed since the previous frame, in
   device pixels (`render::Region`, a few merged rectangles). `ui::Surface`
   records which nodes changed (style, text, children, selection, scroll,
   focus); the damage tracker compares where every node drew last frame with
   where it draws now, so a node that moved, resized (by any fraction of a
   pixel) or went away is caught as well as one that changed. Only the damage
   is drawn again: each rectangle with Skia into a scratch bitmap with a
   margin, then copied in. An unchanged frame rasterizes nothing.
   - Skia flattens a curve cut by a clip slightly differently, so where damage
     cuts a curve its edge pixels may differ from a full redraw by a few
     levels (tests bound it). Everything else is exact.
3. **Compositing (the backend).** A `render::Compositor` puts the layers
   together and presents them, again drawing only what changed (the layers'
   damage, and wherever a layer appeared, moved, went away or changed order).
   The backend owns it, so it outlives a reloaded runtime; `capabilities()`
   and `statistics()` say what it is and what the last frame cost (layers,
   bytes uploaded, texture allocations, draw calls, readbacks). The frame's
   own statistics count the layers rasterized, GPU layers, and GPU images
   read back for want of a compositor that could draw them.
   - `render::GpuCompositor` composites on the GPU and presents into a native
     view (see "The GPU"). CPU layers become textures, uploaded only where
     they changed; an unchanged frame uploads, draws and presents nothing.
   - `render::RasterCompositor` composites on the CPU with Skia into a
     `render::RasterTarget` (pixels the platform shows). It is the fallback
     that always works.

The generated JUCE editor renders a frame from its 60 Hz timer when
`RuntimeHost::needsRender()` says the picture changed (a blinking caret
counts, twice a second). It makes its GPU device first
(`GpuCompositor::createDevice()`) and gives it to the `RuntimeHost`, so that
WebGL and the compositor share it. Once it has a native view, it asks for a
`GpuCompositor` on that device and logs which renderer it got, and why when it is the CPU
(`renderer: GPU compositor, ANGLE / Metal (…)`). Otherwise, and if the GPU is
lost later, it composites on the CPU into a `backend::JuceImageTarget`: a
`juce::Image` at device resolution, of which only the damaged parts are
repainted. `SOUNDOR_RENDERER=cpu` forces the CPU. `RuntimeHost::render(bitmap)`
still draws the whole view in one go, for tests and tools.

`ui::Renderer` draws nodes with [Skia](https://skia.org) on the CPU:

- **Output:** 32-bit premultiplied pixels, B, G, R, A in memory everywhere
  (`render::Bitmap`), which is `juce::Image::ARGB`'s layout.
- **Boxes:** backgrounds, borders, per-corner radii, opacity, overflow
  clipping, scrolling, text, images, and inputs with selection and a caret.
- **Opacity** is a node's and everything in it, drawn as one picture into a
  layer. A view that paints a single shape (a background, without a border
  or children) is drawn with the opacity in its paint instead, which looks
  the same; a view, image or canvas without children gets a layer only the
  size of its box.
- **Colors:** any CSS color: hex, `rgb()`, `hsl()`, names, `transparent`. An
  invalid one is a `TypeError` naming the property.
- **Text:** the platform's fonts (CoreText, DirectWrite, fontconfig/FreeType),
  with per-character fallback, so accents, symbols and CJK render. Shaping is
  simple: one glyph per code point, no ligatures or kerning, no complex scripts
  or bidi; those need HarfBuzz and ICU. The same text engine lays text out, so
  layout matches what is drawn. Tests that need machine-independent sizes use
  `ui::approximateTextEngine()`.

### The GPU

`src/gpu/` wraps ANGLE (see "Dependencies"), the only directory that includes
its headers.

- **`gpu::Device`:** a GPU device and ANGLE's EGL display over it. Each device
  has a display of its own, so destroying one never affects another editor's
  or another plugin's. It belongs to the thread that created it (the UI
  thread); debug builds assert that its contexts are used there only.
- **Which device:** the platform's backend: Metal, Direct3D 11 or Vulkan.
  `DevicePolicy` says whether software renderers (SwiftShader, llvmpipe,
  lavapipe, WARP, told apart by their names) are acceptable: `HardwareOnly`
  (the default, so a heavy scene never silently runs on the CPU),
  `AllowSoftware` or `SoftwareOnly` (tests, debugging). Without an acceptable
  device, `Device::create()` returns null and says why; the caller falls back
  to the CPU.
- **OpenGL on Linux:** ANGLE can also run on the system's EGL, but every user
  of EGL in the process shares the system's display, and ANGLE terminates it
  when a device goes away, taking the others' with it. So it is used only when
  asked for (`Backend::OpenGL`), for development machines without Vulkan.
- **`gpu::Context`:** an OpenGL ES 3.0 context without a surface: it draws into
  framebuffers it makes. With `webgl`, it is ANGLE's WebGL-compatible context
  (`EGL_CONTEXT_WEBGL_COMPATIBILITY_ANGLE`): WebGL's validation, robust
  resource initialization, and extensions only once requested.
  `gpu::CurrentContext` makes one current for a scope and restores what was
  current before.
- **The GPU compositor:** `render::GpuCompositor` (public, no GPU types) is
  a device, an ES context and an EGL window surface in a presentation. Its
  `gpu::LayerRenderer` is deliberately small: one textured quad per layer
  with the layer's transform, opacity and rounded clip (antialiased by
  distance; within a few levels of Skia's except along a clip's curves),
  premultiplied alpha, `GL_BGRA` textures uploaded row by row from the CPU
  surfaces' damage. It never waits for the GPU (`glFinish`). It wants a
  hardware device (`allowSoftware` is for tests) and reports a lost GPU
  through `healthy()`.
- **Presentation:** what the compositor presents into, inside the view the
  backend gives, without registering or subclassing anything:
  - macOS: a plain `CALayer` added on top of the `NSView`'s layer (ANGLE puts
    its `CAMetalLayer` inside). The view keeps its input and its own drawing
    underneath.
  - Windows: a child window of the system's `STATIC` class over the `HWND`,
    for ANGLE's Direct3D 11 swap chain; it answers `HTTRANSPARENT` to hit
    tests, so input goes to the view's window.
  - Linux: none. Presenting from Vulkan into the host's X11 window would need
    ANGLE built with X11 and xcb, linked into every plugin, and a plugin must
    load where they are missing (JUCE loads X11 at run time for this reason).
    So Linux composites on the CPU, and the GPU's work (WebGL) is read back.
- **WebGL** (`src/gpu/webgl/`): a canvas's `WebGL2RenderingContext` is an
  OpenGL ES 3.0 context in ANGLE's WebGL compatibility mode, so ANGLE checks
  every call the way a browser's WebGL does. Its `*RobustANGLE` entry points
  bound every read and write of JavaScript memory.
  - **JavaScript:** `webgl.js` converts arguments the way WebIDL does. It
    checks WebGL objects: one from another context or a deleted one is an
    `INVALID_OPERATION`, and so is a uniform location of another program or
    an earlier link. Each method makes one native call
    (`webglCall(id, op, …)`), with no arrays made on the way; the generated
    ones look the context up once and convert their numbers inline. Methods
    whose arguments are only numbers,
    booleans and objects are generated from the Khronos IDL in `idl/`
    (`scripts/webgl-codegen.mjs`, `pnpm gen:webgl`, kept current by a test),
    and so are the TypeScript declarations. The rest are hand-written, in
    `webgl.js` and `WebGLModule.cpp`, numbered in the same order.
  - **Which GPU:** the device the host gives
    (`RuntimeHost::Options::gpuDevice`), or else one of WebGL's own, made
    with the first context. It must be hardware unless the host allows
    software (`allowSoftwareGpu`, for tests). Without one, `getContext()`
    returns null and the console says why.
  - **The drawing buffer:** WebGL's default framebuffer is a framebuffer
    Soundor makes, the canvas's size. It is multisampled with `antialias`
    and resolved before anything reads it. `bindFramebuffer(…, null)` binds
    it, and it cannot take attachments. The viewport starts at its size.
    Resizing the canvas resizes it and clears it. After it is shown, it is
    cleared unless `preserveDrawingBuffer` is set.
  - **Showing it:** after each `tick()`, a context that drew copies its
    drawing buffer on the GPU (resolving it if multisampled) into one of two
    presentation textures. That texture is the canvas's `gpuImage`. Every
    context of a device shares one texture namespace
    (`EGL_ANGLE_display_texture_share_group`, on Metal, Direct3D 11, Vulkan
    and OpenGL; EGLImages from textures don't exist on Metal). So a GPU
    compositor on the same device samples that texture directly, as a layer:
    there is no read-back, the UI is not redrawn, and neither side waits on
    the CPU. Where the device has EGL fences, they order the producer's and
    the compositor's GPU work. WebGL code reaches only its own textures,
    because it names objects through its context's wrappers. Anywhere else,
    the image is read back into the
    canvas's pixels when the frame is made, and drawn like a 2D canvas's
    (converted when `alpha` or `premultipliedAlpha` is false). That happens
    with another device, a CPU compositor (Linux, `SOUNDOR_RENDERER=cpu`, a
    lost GPU), `RuntimeHost::render()`, or a clip that one rounded
    rectangle can't express. Read-backs are counted
    (`FrameStatistics::gpuReadbacks`, `WebGLContext::readbacks()`).
  - **Texture sources:** typed arrays, a `PIXEL_UNPACK_BUFFER` offset,
    `ImageData`, and canvas nodes (RGBA, `UNSIGNED_BYTE`), honoring
    `UNPACK_FLIP_Y_WEBGL` and `UNPACK_PREMULTIPLY_ALPHA_WEBGL`.
  - **Extensions,** where the device has them: `EXT_color_buffer_float`,
    `EXT_color_buffer_half_float`, `EXT_float_blend`,
    `EXT_texture_filter_anisotropic`, `EXT_texture_norm16`,
    `KHR_parallel_shader_compile` (everywhere: where the driver lacks it,
    compiling is done when it returns, and its status is always true),
    `OES_texture_float_linear`,
    `WEBGL_debug_renderer_info` and `WEBGL_lose_context`.
  - **Objects** live until deleted, or until their context goes. Textures
    included: a device's contexts share textures (see "Showing it"), so each
    WebGL context deletes the ones its code made when it goes. A released
    canvas, or a reloaded UI, leaves nothing on the editor's device. Dropping a
    wrapper does not delete the OpenGL object, because OpenGL keeps it in
    use while it is bound.
  - **Losing the GPU:** contexts are made to be lost on a GPU reset
    (`EGL_EXT_create_context_robustness`), and each tick asks whether they
    were. A lost context is reported to JavaScript at the next tick: calls
    then do nothing, `getError()` says `CONTEXT_LOST_WEBGL` once, and the
    canvas gets `webglcontextlost`. `WEBGL_lose_context`'s `loseContext()`
    loses the context the same way (`GL_CHROMIUM_lose_context`). The GPU
    compositor notices the reset too, and the editor composites on the CPU
    from then on.
  - **Diagnostics:** the first context logs which GPU WebGL runs on, and
    whether it can be composited without copies. Without an acceptable GPU,
    `getContext('webgl2')` logs why it returns null.
  - **Not there:** WebGL 1, `restoreContext()`, `drawingBufferStorage()`,
    color spaces other than sRGB, XR, and uploads from image nodes. They
    throw a `TypeError` saying so. `finish()` only flushes, because Soundor
    never waits for the GPU on the UI thread.
- **Three.js:** WebGL is tested against Three.js's `WebGLRenderer`, the
  unmodified npm package pinned in `cmake/SoundorDependencies.cmake`
  (`tests/gpu/ThreeTests.cpp`). The tests cover lights and shadows, physical
  materials, tone mapping, PMREM environments, multisampled, float, cube and
  depth render targets, instancing, morph targets, skinning, points, lines
  and sprites, transmission, and canvas, data, array and 3D textures. They
  also cover GLSL 3 shader materials with uniform blocks, clipping planes, a
  logarithmic depth buffer, `setSize()`, the animation loop, and
  asynchronous compiling and reading. Each case checks for no WebGL errors
  and no warnings from Three, and checks pixels where they are defined. An
  animated scene is composited without read-backs. Three needs nothing from
  the DOM for these. Its image loaders do (`document`), so images reach
  Three as canvas nodes or `ImageData` instead.
- **`soundor_run_ui`** (`tests/tools/RunUi.cpp`, built with the tests, and
  alone in Release by the `bench` preset) runs a built UI bundle headless on
  the GPU, as the editor would. It uses an offscreen GPU compositor on the
  UI's device, evaluates an expression (awaiting a promise), and times every
  frame in three parts: `tick()`, `frame()` and compositing (CPU times;
  nothing waits for the GPU). It reports them with GPU read-backs, CPU layers
  rasterized, bytes uploaded and the host's statistics (native calls, style
  changes, layouts, invalidations, engine allocations; see `RuntimeHost`), in
  total and per phase: a UI names what it is doing in
  `globalThis.soundorRunUiPhase`. Ticks that render nothing are counted and
  timed apart. `--json` writes the report, `--backend` picks ANGLE's backend,
  `--time-native-calls` times native calls. `tools/benchmark` uses it
  (`pnpm bench` there).
- **Tests:** the GPU tests run on whatever device there is, software ones
  included, and say they were skipped when there is none. CI provides one
  (lavapipe on Linux, WARP on Windows, Metal on macOS) and sets
  `SOUNDOR_REQUIRE_GPU=1`, which turns a missing device into a failure. The
  GPU compositor's output is compared with the CPU compositor's (order,
  alpha, opacity, transforms, clips), its uploads are counted, and on macOS
  and Windows it presents into a real window.

### Accessibility

Soundor owns its accessibility semantics: what a screen reader perceives of
the view is decided here, from the node tree, not by JUCE or any other plugin
framework. A platform adapter (AccessKit, the Apple bridge) only translates
the result.

```ts
knob.accessibility = {
  role: 'adjustable',
  label: 'Gain',
  value: { min: -60, max: 12, now: -3.5, text: '-3.5 dB' },
  actions: [{ name: 'increment' }, { name: 'decrement' }],
};
knob.addEventListener('accessibilityaction', (event) => {
  if (event.actionName === 'increment') nudge(+1);
});
```

- **`node.accessibility`** (`a11y::Properties`): `accessible`, `role`,
  `label`, `hint`, `state` (`disabled`, `selected`, `checked` incl.
  `'mixed'`, `busy`, `expanded`), `value` (`min`, `max`, `now` as doubles,
  `text`), `actions` (standard names or custom ones with a label) and
  `modal`. Replaced as a whole; invalid values throw a `TypeError` naming
  them.
- **The semantic tree** (`a11y::SurfaceSemantics`) is not the node tree:
  - A node is an element when it means something: a text node with text, an
    input, a node with a role (other than `'none'`), a label or
    `accessible: true`, or a modal. Views and images are not by default
    (images are decorative until labelled). `accessible: false` takes the
    node itself out, never its descendants.
  - An element of a leaf role (button, adjustable, checkbox, text…), or a
    role-less one made `accessible: true`, is read as a whole: without a
    label, it is labelled by its descendants' labels or text, in tree order,
    and they are not elements of their own. Container roles (dialog,
    toolbar, menu, radiogroup…) keep their elements as children.
  - Nodes with `display: 'none'` (or under one) and nodes outside the view
    are not read. `opacity: 0` is still read: it may be animating in.
  - `accessibilityParent` reads a node under another one rather than its
    parent: an overlay a portal opened from a modal is part of the modal.
    Parents that would loop are ignored.
  - While a `modal` element is shown, the tree holds only it and what it
    holds; the last one in reading order wins, so a modal opened from another
    supersedes it until it closes.
  - Reading order is tree order (not `zIndex`), the content before the
    overlay.
- **Identity:** an element keeps its `a11y::NodeId` while it is one. Ids are
  unique in the process and never reused, so a platform request naming an
  element that has gone (even from before a reload) finds nothing.
- **Updates:** `update()` walks the tree only when the surface changed
  (`Surface::revision()`) or focus moved, and returns just the elements
  that changed and the ids removed; nothing is computed until an adapter
  asks. Bounds are the view's logical pixels; adapters convert them to
  their platform's coordinates.
- **Actions:** `RuntimeHost::performAccessibilityAction()` checks the
  element still exists, offers the action and is not disabled, then
  dispatches a bubbling, cancelable `accessibilityaction` event
  (`actionName`, `value`) at its node. `preventDefault()` marks it handled.
  Left alone, `focus` and `blur` move keyboard focus, `activate` focuses an
  input, and `setValue` replaces an input's text; `pressable()` answers
  `activate` (and `longpress` with `onLongPress`).
- **Focus:** keyboard focus is reported as the element holding the focused
  node. Assistive technology moving its own cursor changes nothing in the
  view; only an explicit `focus` action requests keyboard focus.
- **Threading:** everything runs on the UI thread. An adapter whose
  platform calls from another thread marshals requests to it first.

#### Platform accessibility

`a11y::createPlatformAccessibility({ view, name })` presents a view's
semantic tree to the platform. A plugin framework only says where: the
native view (`NativeView`: the HWND on Windows), the surface's place and
scale in it (`ViewGeometry`), and whether its window has focus. The
generated JUCE editor does this from its peer; another framework (iPlug2)
would pass its own view the same way. Call `tick(host)` after every
`RuntimeHost::tick()`.

| Platform | Backend                             | State                                                      |
| -------- | ----------------------------------- | ---------------------------------------------------------- |
| Web      | DOM / ARIA (`@soundor/web-runtime`) | built in                                                   |
| Windows  | AccessKit (UI Automation)           | built in                                                   |
| Linux    | AccessKit (AT-SPI)                  | x64; not arm64 (no prebuilt AccessKit)                     |
| Android  | AccessKit                           | not attached: Soundor has no Android view to attach to yet |
| macOS    | Soundor's Apple bridge              | not yet: `createPlatformAccessibility()` returns null      |
| iOS      | Soundor's Apple bridge              | not yet                                                    |

The AccessKit adapter (`src/a11y/accesskit/`, the only code that includes
`accesskit.h`) works like this:

- **Lazily:** nothing is computed until assistive technology asks. The
  activation callback only raises a flag, and the next tick sends the whole
  tree. After that, each tick sends just the changed elements, or nothing.
- **Mapping:** roles, states, ranges and actions are mapped in
  `Mapping.cpp`. Standard actions become AccessKit's (click, increment,
  decrement, focus, blur, set value, expand, collapse). `longpress` and
  custom actions are AccessKit custom actions, identified by their place
  among the element's actions. Bounds stay logical pixels; the root's
  transform places and scales them in the native view.
- **Threads:** the platform's requests may come on any thread. They are
  copied into a queue and performed by `tick()` on the UI thread, through
  `RuntimeHost::performAccessibilityAction()`, against the tree the platform
  was shown. Requests from before a reload are dropped.
- **Lifetimes:** callbacks carry a token, not a pointer. They find their
  adapter in a registry of weak references, so a late callback does
  nothing. Once AccessKit has started code the platform may call later (UI
  Automation providers a screen reader holds, the AT-SPI thread), the plugin
  binary is pinned in memory: unloading it then would crash the host.
- **Windows:** `accesskit_windows_adapter` answers `WM_GETOBJECT` through a
  subclass of the one HWND (`SetWindowSubclass`), removed with the adapter.
  No window class is changed. AccessKit's subclassing adapter is not used: it
  must exist before the window is first shown, which a plugin cannot
  guarantee, and it panics (aborting the host) otherwise.
- **Linux:** `accesskit_unix_adapter`, positioned by the view's screen bounds
  (X11; Wayland does not tell them).

The macOS bridge (`src/a11y/apple/`) is Soundor's own: virtual
`NSAccessibilityElement`s, one runtime-created element class per binary
under a random name, no swizzling, and the binary pinned once the class
exists. It activates while VoiceOver or Switch Control is on. Its
attachment, lifecycle and the manual VoiceOver checklist are in
[Apple bridge notes](/docs/contribute/apple-accessibility).

### `RuntimeHost`

`RuntimeHost` is what a backend creates per plugin view: a runtime and context
with `soundor:parameters` and the generated `soundor:native` installed. The
backend calls `tick()` from its UI thread every frame. The generated JUCE editor
owns one and ticks it from a 60 Hz `juce::Timer`. Its processor supplies the
`soundor:native` implementation by overriding `createNativeApi()`. Each host
has its own `ui::Surface` (`surface()`). The editor sizes it every frame and
forwards mouse, wheel and keyboard input to it, then runs pending jobs.

`RuntimeHost` also loads the plugin's UI. Given `platform::Resources` (the UI
bundle compiled in with `soundor_embed_ui()`, as bytecode where the build can
compile it, or a directory in development) and an entry such as `/bundle.js`, it evaluates the entry after
installing the modules. A failing entry is logged and leaves the host usable.
`RuntimeHost::asset(id)` returns the bytes of a bundled image.
`RuntimeHost::frame()` renders the view for a compositor (see "Rendering").
`Options::gpuDevice` is the device canvases' WebGL contexts use (see "WebGL"),
and `tick()` shows what they drew.

`RuntimeHost::statistics()` says what the host did since it was created, for
profiling and benchmarks; take differences for a frame or a phase. Counting is
always on and costs an increment:

- **`tick`:** the time each step of `tick()` took: Web timers and finished
  async work, parameter changes, promise jobs, animation frame callbacks,
  showing what WebGL drew.
- **`runtime`** (`js::RuntimeStatistics`): calls into `soundor:ui`, Canvas 2D
  and WebGL, counted at their native entry points. With
  `RuntimeOptions::timeNativeCalls` they are timed too (a clock read on entry
  and exit; only the outermost of nested calls). Hermes's collector counters
  report collections, cumulative allocated object bytes, and the current
  heap plus external bytes. These are engine measurements, not process RSS
  or GPU memory.
- **`surface`** (`ui::SurfaceStatistics`): style changes, Yoga layout passes
  and their time, nodes invalidated.

The headless `soundor_run_ui` runner reports frame mean, P50, P95, P99,
maximum and population standard deviation, plus separate startup measurements.
All compositor timings are CPU submission times, not GPU execution times.
For repeatable scenario comparisons, `--collect-between-phases` collects and
drains detached-stage finalizers once before each named phase, flushes setup
damage, and then resets timing/counter baselines. Collections triggered by the
measured workload remain included. Normal plugin execution does not use this
benchmark-only preparation. See [animation benchmarks](/docs/contribute/benchmark#animation-baselines)
for scenarios, recorded Hermes revisions and alternating saved-build comparisons.

### `DevSession`

In development the UI is not embedded. `DevSession` owns the `RuntimeHost`
instead: it loads the bundle directory `soundor dev` keeps rebuilding, polls its
`build-id` file (written last, after a complete build), and on a new id destroys
the host and creates a fresh one. Nothing of the old UI survives a reload. A
build whose entry fails is logged; the next good build recovers.
`platform::fileLogSink()` appends the log as JSON lines to a file that
`soundor dev` shows in its terminal. The generated JUCE editor uses both when
`setup.cmake` receives `SOUNDOR_UI_DEV_DIR`.

### Threading and lifetime

A `Runtime` and its `Context`s belong to the thread that created the runtime: the
UI/message thread. Debug builds assert this. Background work must hand results
back to that thread before touching JavaScript.

Each `Context` is a Hermes runtime of its own, and each has a thread of
Hermes's own: its collector (Hades) collects the old generation concurrently
there, while JavaScript keeps running, and finalizes what it collects there
too. That thread runs no JavaScript, and Soundor's finalizers only queue:
FinalizationRegistry cells and the native objects of handles go to the
context under a mutex, and are reported and released on the context's thread
when its jobs drain (`ContextState::runFinalizers`, `releaseHandles`). A host
with ten plugin editors open has ten of these threads. With a time limit,
Hermes has one more thread per plugin binary (its `time-limit-monitor`),
asleep until a deadline passes, when it asks the engine to stop.

A context's heap, with its jobs, is released when the context is destroyed;
the `Runtime` and its `Context`s may go in any order. Destroying everything and
creating fresh instances is the supported reload path. Tests cover repeated
create/destroy and teardown with jobs and rejections still pending. Debug
builds assert, when a context frees its Hermes runtime, that C++ holds none of
its values any more.

## Dependencies

All dependencies are fetched by CMake (`FetchContent`) from exact revisions,
verified by SHA-256, and built privately. See `cmake/SoundorDependencies.cmake`.

| Dependency  | Version             | License          | Role                                                            |
| ----------- | ------------------- | ---------------- | --------------------------------------------------------------- |
| Hermes      | main (`602befe`)    | MIT              | JavaScript engine (shipped: the interpreter; built from source) |
| QuickJS-NG  | v0.17.0 (`6d46d07`) | MIT              | Unicode tables for Hermes on Linux (shipped: libunicode)        |
| ada         | v3.4.4 (`8d50724`)  | MIT / Apache-2.0 | WHATWG URL parser (shipped, ~370 KB stripped)                   |
| Yoga        | v3.2.1 (`042f501`)  | MIT              | flexbox layout (shipped)                                        |
| Skia        | m144 (`ed427fd`)    | BSD-3-Clause     | 2D rendering (shipped; built from source)                       |
| ANGLE       | M151 (`7e08726`)    | BSD-3-Clause     | OpenGL ES 3 on the GPU (shipped; built from source)             |
| accesskit-c | 0.23.1              | MIT / Apache-2.0 | Windows/Linux accessibility (shipped; official prebuilt)        |
| doctest     | v2.5.3 (`2d0a935`)  | MIT              | test framework (tests only)                                     |
| three       | 0.186.1 (npm)       | MIT              | WebGL compatibility tests (tests only)                          |

Hermes is built by its own CMake, once per machine and configuration
(revision, Soundor's patches, compiler, platform, architectures), into
Soundor's cache, like Skia (`SoundorHermes.cmake`; the first configure takes
several minutes; `SOUNDOR_HERMES_DIR` points at another build of it). It is
always an optimized build, whatever the configuration: its headers do not
depend on it. Its libraries are linked `PRIVATE`, and its API's
`JSI_EXPORT`/`HERMES_EXPORT` are defined empty on both sides, so nothing of it
is exported from a plugin. Sanitizer builds do not instrument it (as Skia and
ANGLE). Cross-compiling needs a Hermes for the target with a host `hermesc`,
which the build does not make yet (`SOUNDOR_HERMES_DIR`).

Yoga is compiled from its `yoga/` sources into `soundor_yoga` the same way.
Upstream marks its C API `visibility("default")`, so `SoundorYogaPatch.cmake`
rewrites `YG_EXPORT` after download (and after the hash check). That keeps
every `YG*` symbol inside the plugin; the symbol-isolation test fails without
the patch.

### Skia

Skia is built from source, CPU-only, at the pinned `chrome/m144` commit. It
gets only its PNG, JPEG, WebP and zlib code, each at the commit Skia's `DEPS`
pins. It has no GPU backends, PDF, SVG, ICU or HarfBuzz.

- **The build:** `cmake/SoundorSkiaBuild.cmake` runs gn and ninja.
  `cmake/SoundorSkia.cmake` runs it during the first configure on a machine
  (about two minutes on four cores) and caches the result in the user cache
  directory (override with `SOUNDOR_CACHE`), keyed by revision, build script,
  compiler and architectures. Every later configure reuses it.
- **Prerequisites:** git, Python 3 and ninja. `soundor doctor` checks them.
- **Using your own build:** set `SOUNDOR_SKIA_DIR` to a Skia install made by
  that script.
- **Flavours:** Windows gets one library per C runtime (`/MD` and `/MDd`).
  macOS universal builds get one per architecture, merged with `lipo`.
- **Hiding symbols:** Skia's own symbols are hidden. libwebp exports its API
  unless `WEBP_EXTERN` is redefined, which the build does; the symbol test
  catches it otherwise.

### ANGLE

[ANGLE](https://chromium.googlesource.com/angle/angle) implements OpenGL ES 3
(and WebGL's rules) on each platform's own graphics API: Metal on macOS,
Direct3D 11 on Windows, Vulkan on Linux. Soundor uses it for the GPU
compositor and WebGL (see "The GPU").

- **The pin:** the head of ANGLE's `chromium/7922` branch (Chrome 151),
  `7e08726`. Its third-party code comes at the commits ANGLE's `DEPS` pins,
  and only what the static libraries need: Chromium's `build/` configuration,
  abseil, zlib, and on Linux the Vulkan headers, SPIR-V tools, the Vulkan
  memory allocator and libdrm. `cmake/angle/deps.py` reads `DEPS` without
  executing it.
- **The build:** gn decides what ANGLE is made of for the platform
  (`gn gen --ide=json`), and `cmake/angle/targets.py` turns that into a CMake
  project that Soundor compiles with its own compiler, not Chromium's: Clang
  (the project's, or the one on PATH) on Linux and macOS, MSVC on Windows. So
  ANGLE gets the plugin's C runtime (`/MD` and `/MDd` on Windows) and hidden
  visibility like everything else. gn itself is the version ANGLE's `DEPS`
  pins, downloaded from CIPD and checked against a SHA-256 per host platform.
  `cmake/SoundorAngleBuild.cmake` does all this during the first configure on
  a machine and caches the result in the user cache directory like Skia.
- **Patched:** `cmake/SoundorAnglePatch.cmake` changes one thing after the
  checkout. `Display::terminate` joins ANGLE's worker threads before the
  backend terminates instead of after: on Vulkan, terminating destroys the
  instance and the loader unloads the driver, and a worker that had made
  Vulkan calls would then exit into the driver's unloaded thread-exit code
  (Mesa's Venus driver crashes the process on every `eglTerminate`). The patch
  fails the build when ANGLE's code no longer matches, so an ANGLE update has
  to revisit it.
- **Prerequisites:** git, Python 3 and ninja, as for Skia.
- **Using your own build:** set `SOUNDOR_ANGLE_DIR` to an install made by that
  script. `-DSOUNDOR_ENABLE_GPU=OFF` builds without ANGLE (CPU only).
- **Backends:** only the platform's own. On macOS that excludes ANGLE's OpenGL
  backend, which defines an Objective-C class. Linux also has OpenGL through
  the system's EGL, used only when asked for (see "The GPU").
- **No new dependencies:** the Vulkan loader and EGL are loaded at run time,
  so a plugin still loads on a machine without them; it just has no GPU.
- **Hiding symbols:** ANGLE marks its API `ANGLE_EXPORT` and the Khronos
  headers `KHRONOS_APICALL`. The build defines both to nothing
  (`ANGLE_EXPORT=`, `KHRONOS_STATIC`), so no EGL, GLES or ANGLE symbol leaves
  the plugin. The symbol test links ANGLE into the probe plugin.
- **Licenses:** a plugin binary contains ANGLE (BSD-3-Clause) and the
  third-party code above (abseil and SPIR-V tools: Apache-2.0; zlib; MIT and
  BSD for the rest). The install's `licenses/` directory has their notices;
  ship them with the plugin.

### AccessKit

[AccessKit](https://github.com/AccessKit/accesskit-c) presents the semantic
tree to UI Automation (Windows) and AT-SPI (Linux). It is written in Rust,
so Soundor uses the official prebuilt static libraries from the pinned
`accesskit-c` release archive rather than asking every plugin developer for
a Rust toolchain:

- **The download:** `cmake/SoundorAccessKit.cmake` downloads the archive once
  per machine into the cache directory (`SOUNDOR_CACHE`), checks its SHA-256,
  and keeps the header and this platform's static library. Set
  `SOUNDOR_ACCESSKIT_DIR` to an extracted release to use your own build.
- **Platforms:** the release has Windows x64 and arm64 (MSVC), Linux x64 and
  Android libraries. Linux arm64 has none, so it builds without platform
  accessibility, as does any build with `SOUNDOR_ACCESSKIT=OFF`. macOS and
  iOS never use AccessKit: Soundor has its own Apple bridge there.
- **One build for all configurations:** the library is a release build
  (LTO, `panic = "abort"`) against the dynamic C runtime. It only exchanges
  C data with Soundor, and Rust allocates through the system allocator, so
  Debug (`/MDd`) builds link it too.
- **Hiding symbols:** the archive's symbols have default visibility. The
  imported target passes `--exclude-libs` for it on ELF platforms, so none
  of them is exported. The symbol test links it into the probe plugin.
- **Licenses:** a plugin binary contains AccessKit, under MIT or Apache-2.0,
  and code derived from Chromium (BSD-3-Clause, `LICENSE.chromium` in the
  archive). Ship their notices with the plugin.

## Symbol isolation

Several Soundor plugins can be loaded into one host process, so nothing Soundor
or its dependencies define may be exported from a plugin binary:

- Everything is compiled with hidden visibility (`-fvisibility=hidden`,
  `-fvisibility-inlines-hidden`) and linked statically.
- Every Soundor C++ symbol lives in the inline namespace
  `soundor::SOUNDOR_ABI_NAMESPACE`. The namespace is generated from the exact engine npm version (for example,
  `0.1.0` gives `v0_1_0`); consumers cannot override it. The JUCE integration
  references an out-of-line ABI anchor that also checks Debug/Release, DevTools
  layout, standard-library ABI and iterator debugging. Source code keeps writing
  `soundor::js::Context`; plugin copies of the same engine remain isolated by
  hidden visibility and final binary export restrictions.
- The `soundor_exported_symbols` test links the runtime into a plugin-shaped
  shared library and fails if it exports anything but its own entry point.
  Standard-library template instantiations are tolerated, because `std` headers
  force default visibility on them. A negative-control test proves the check
  catches a leaked symbol. The check runs on Linux and macOS.
- On Apple platforms the same check fails on any Objective-C class or
  category compiled into the binary. Classes share one process-wide namespace
  whatever their symbols' visibility, so two plugins defining one would
  collide, and a category changes a class every binary shares. Negative
  controls cover both checks.
- The probe library creates a full `RuntimeHost`, lays out and draws a UI and
  creates a GPU device and context, so Hermes, ada, Yoga, Skia and its
  codecs, and ANGLE are all linked into what is checked. A future ANGLE
  update that introduced an Objective-C class or category, or an exported
  EGL or GL symbol, fails the build.

## Coexistence

Plugins built with Soundor must run side by side in one host process, each
with its own copy of the runtime. Two tests prove it:

- **`soundor_coexistence` (CTest, every platform in CI).** It builds the
  same engine archive, under the same package ABI namespace, into two
  plugin-shaped modules. Each draws its own color and counts its own clicks.
  A host program loads both (`dlopen` with `RTLD_LOCAL`, or `LoadLibrary`). It
  runs two instances of one and one of the other interleaved, destroys them in
  mixed order, and unloads and reloads both. Every instance also draws its
  color on the GPU with a device of its own, through its own module's ANGLE
  (shader compiler included), and must keep doing so while instances of
  either plugin come and go. The two modules' exports are checked as well.
- **`soundor_juce_coexistence` (JUCE adapter tests, local).** It loads two real
  VST3s built from different plugin ids through JUCE's plugin hosting.
  - **Audio and parameters:** it processes audio in both and moves one
    plugin's parameter; the other's must stay put.
  - **Editors:** it opens both side by side and reads them back from the
    screen, so both React UIs must really have rendered. It closes one; the
    other must keep running and follow its parameter.
  - **Running it:** give it the plugins with
    `-DSOUNDOR_COEXISTENCE_PLUGINS="a.vst3;b.vst3"`. On Linux it needs a
    display; `xvfb-run` works.

## Footprint

Measured on Linux x64, Release, with the stripped VST3 binary (everything:
Hermes, ada, Yoga, Skia, ANGLE, AccessKit, JUCE and the UI), against the same
build with QuickJS-NG before it (both linked with `--gc-sections`):

| What                                     | QuickJS-NG | Hermes   | Difference |
| ---------------------------------------- | ---------- | -------- | ---------- |
| `examples/basic` (React UI), VST3 binary | 20.79 MB   | 21.84 MB | +1.05 MB   |
| `tools/benchmark` (React, Three.js)      | 21.44 MB   | 22.72 MB | +1.29 MB   |
| …its UI bundle's bytecode                | 832 kB     | 1,149 kB | +316 kB    |
| …the runtime's own modules' bytecode     | 205 kB     | 400 kB   | +195 kB    |
| `examples/basic`'s UI bundle's bytecode  | 184 kB     | 262 kB   | +78 kB     |

(MB and kB are 10⁶ and 10³ bytes.) So the engine itself (the VM without its
compiler) costs about 0.78 MB more than QuickJS-NG; the rest is bytecode,
which is larger for Hermes, and for the runtime's modules also the lowered
syntax and the language layer.
`--gc-sections` (`-dead_strip` on macOS), which the generated `setup.cmake`
adds to Release plugins, takes about 1.8 MB off a plugin (Skia and ANGLE
included); Hermes is compiled with a section per function for it. ThinLTO of
Hermes (`-DSOUNDOR_HERMES_LTO=ON`) made the plugin 84 KB larger, not smaller.
Unstripped, the binary also carries about 28 MB of symbol tables (no debug
information in Release).

## Building and testing

From the repository root:

```sh
pnpm test      # includes the native tests (the `dev` preset)
pnpm lint      # includes clang-tidy (the `tidy` preset)
pnpm format    # includes clang-format 18 over these sources
pnpm check     # format + lint + build + test
```

Or directly, from `runtimes/engine/`:

```sh
cmake --workflow --preset dev        # Debug, -Werror, tests
cmake --workflow --preset sanitize   # + AddressSanitizer / UBSan / LeakSanitizer
cmake --workflow --preset tidy       # + clang-tidy (build only)
cmake --workflow --preset nogpu      # without ANGLE, as on iOS (no WebGL)
cd ../juce-runtime/native && cmake --workflow --preset juce   # + JUCE adapter tests
```

The JUCE adapter tests need a JUCE checkout. JUCE is never part of either
package; CI checks out a pinned JUCE for them, outside both. Run them wherever
JUCE is installed, for example the two-plugin host test:

```sh
cmake -S . -B build/juce -DSOUNDOR_JUCE_TESTS=ON -DJUCE_DIR=/path/to/JUCE \
  -DSOUNDOR_COEXISTENCE_PLUGINS="/path/A.vst3;/path/B.vst3"
cmake --build build/juce && (cd build/juce && xvfb-run -a ctest -R coexistence)
```

Requires CMake ≥ 3.25 for the presets (the library itself needs 3.22) and a
C++20 compiler. CI builds with Clang 18 and GCC on Linux, Apple Clang on macOS,
and MSVC on Windows, and runs the sanitizer preset on Linux.

## Prebuilt engines

The engine's native libraries, compiled once per engine version and published
as a GitHub release, so that a plugin build links them instead of compiling
Hermes, Skia and ANGLE. A release has six archives: three targets, two
variants each.

| Target            | Architectures    | Toolchain                |
| ----------------- | ---------------- | ------------------------ |
| `macos-universal` | arm64 and x86_64 | Apple Clang, macOS 12.0+ |
| `linux-x64`       | x86_64 (glibc)   | Clang 18 (Ubuntu 24.04)  |
| `windows-x64`     | x64              | MSVC, DLL C runtime      |

| Variant   | Configuration                             | Hermes                         | DevTools | Windows C runtime |
| --------- | ----------------------------------------- | ------------------------------ | -------- | ----------------- |
| `debug`   | Debug                                     | with its compiler (source too) | yes      | `/MDd`            |
| `release` | Release (also RelWithDebInfo, MinSizeRel) | bytecode only                  | no       | `/MD`             |

Skia, ANGLE and Hermes are always optimized builds; on Windows each is built
per C runtime, so the debug archive links the debug one. The C++ ABI identity
is the engine version (`soundor::v0_2_1`) plus the variant, standard library,
iterator debugging, C runtime and DevTools layout, all in the link-time anchor
(`requireEngineAbi()`): a consumer compiled for anything else does not link.

### An archive

`soundor-engine-<version>-<target>-<variant>.tar.gz` holds one directory:

```text
soundor-engine.json      what the archive is: version, ABI namespace, source commit,
                         variant, target, toolchain, features, Hermes, link order
lib/                     the engine, ada, Yoga
hermes/                  the variant's Hermes libraries, its headers (JSI), bin/hermesc
skia/  angle/  accesskit/  their static libraries; ANGLE's and AccessKit's headers
include/soundor/Abi.h    the generated ABI header, for reference
licenses/                the notices of everything linked (licenses/README.md here)
```

The engine's own headers, sources and CMake come from this package; the archive
adds only what compiling would. `hermesc` is the archive's own build: it runs
where the archive's target runs (a universal binary on macOS).

### Using one

`-DSOUNDOR_ENGINE_MODE=prebuilt` (what `juceRuntime()` passes by default) uses
the release this package names in `artifacts/manifest.json`, which only the
published npm package has: `cmake/SoundorEngineResolve.cmake` picks the
archive for the build's target and configuration (Debug: debug; any other:
release; a multi-configuration generator: what `CMAKE_BUILD_TYPE` names, else
both), downloads it into `<SOUNDOR_CACHE>/engine-prebuilts/<sha256>.tar.gz`,
verifies its SHA-256, extracts it once and checks it was built from the
commit the manifest names. A cached, verified archive is reused offline; a
corrupt or interrupted one is downloaded again; parallel configures wait for
each other. Without a manifest, for an unsupported target, or when a download
fails, the configure stops and names source mode; it never compiles instead
(`tests/prebuilt/Resolve.cmake`).

Extracted archives can also be given directly, and the engine's CMake imports
them instead of compiling, with the same targets (`Soundor::Engine`,
`soundor::runtime_internal`, `soundor_hermesc`...):

```sh
cmake ... -DSOUNDOR_ENGINE_PREBUILT_DEBUG_DIR=<extracted debug archive> \
          -DSOUNDOR_ENGINE_PREBUILT_RELEASE_DIR=<extracted release archive>
```

A single-configuration build needs the archive its `CMAKE_BUILD_TYPE` uses; a
multi-configuration build (Visual Studio) uses both, and a configuration whose
archive is missing fails to build rather than link the other's C runtime.
Before anything links an archive, it is checked against this package and the
build: format, engine version, ABI namespace, variant, Hermes revision, target
platform and every target architecture (`CMAKE_OSX_ARCHITECTURES`, not the
machine the build runs on), the macOS deployment target, MSVC and its C
runtime, and that every listed library is there. Each mismatch fails the
configure, saying which (`tests/prebuilt/Rejects.cmake`). Where the build
machine cannot run the archive's `hermesc`, only the debug engine (which
evaluates source) can be used.

### Building them

```sh
SOUNDOR_ENGINE_SOURCE_COMMIT=$(git rev-parse HEAD) cmake --workflow --preset prebuilt-debug
SOUNDOR_ENGINE_SOURCE_COMMIT=$(git rev-parse HEAD) cmake --workflow --preset prebuilt-release
node ../../.github/scripts/engine-prebuilts.mjs pack build/prebuilt-debug/stage <out> --commit <sha>
SOUNDOR_ENGINE_PREBUILT_DIR=<extracted> cmake --workflow --preset prebuilt-check-debug
SOUNDOR_ENGINE_PREBUILT_DIR=<extracted> cmake --workflow --preset prebuilt-check-release
```

The `prebuilt-*` presets stage a variant (`soundor_engine_stage`,
`cmake/SoundorEngineStage.cmake`); on macOS set
`CMAKE_OSX_ARCHITECTURES="arm64;x86_64"` and `MACOSX_DEPLOYMENT_TARGET=12.0`.
Packing checks the stage (variant, features, that the release engine has no
Hermes compiler, every library and license notice) and writes a deterministic
archive: sorted entries, fixed times and owners. The `prebuilt-check-*`
presets run the native tests against an extracted archive: all of them against
the debug engine (coexistence, symbol isolation, the macOS accessibility host,
ABI rejection...), and against the release engine those that run without
Hermes's compiler (two plugins running embedded bytecode, symbol isolation, no
DevTools code, ABI rejection).

### Releases

`.github/workflows/engine-prebuilts.yml` builds all six archives on GitHub's
runners, tests each extracted (the JUCE adapters and the DevTools bridge
included), and releases them as one set, named after the engine version, the
commit and a build revision:

```text
engine-prebuilts-v<version>-<first 8 of the commit>-r<revision>
  soundor-engine-<version>-<target>-<variant>.tar.gz   ×6
  build-info.json   per archive: target, variant, toolchain, SHA-256...; the
                    engine version, ABI namespace, full source commit, revision
  SHA256SUMS        the same checksums, for sha256sum -c
```

The release notes are generated from the same data. Pull requests that change
the prebuilt tooling run it in `validate` mode: archives as run artifacts, no
release. From `main` only, `stage` uploads them to a draft release, verifies
the draft and deletes it (the whole release path, published nowhere), and
`publish` publishes the release (never as the repository's latest) and then
downloads every asset anonymously to check it against `build-info.json`.

A run first looks for the release of its commit: a published one is verified
and reused, never rebuilt or replaced; a draft left by an interrupted run is
finished; a release whose assets or metadata disagree fails the run. Published
releases are immutable (with the repository's release immutability setting):
a defective one is never edited. Only a `publish` run given a higher
`revision` rebuilds a commit; without one, a run reuses the highest published
revision, or builds `r1`. So a rebuild replaces a defective release only until
the engine version is on npm, whose manifest is final: after that, the fix is
a new engine version. A new engine
version always needs its own release, even when only documentation changed,
since the version is the ABI namespace. This release is separate from the
engine's own npm release and its Changesets GitHub release.

`.github/workflows/release.yml` publishes it when a Changesets publish plan
includes `@soundor/engine` (calling `engine-prebuilts.yml` in `publish` mode,
which reuses the commit's release if it exists), then writes
`artifacts/manifest.json` from the release, downloaded anonymously and checked
archive by archive, packs the packages and checks that the packed engine
carries exactly that manifest, and only then publishes to npm. The manifest
is never committed. Releases of other packages build nothing native.

### Licenses

Every archive carries `licenses/`: the notices that ship with each linked
dependency (Skia, Hermes, ANGLE per third-party library, AccessKit), plus those
in this package's `licenses/` for what they leave out: Skia's image libraries,
Hermes's LLVM support and dtoa, QuickJS-NG's Unicode tables, ada, Yoga, the
Rust crates and standard library in AccessKit
(`node .github/scripts/accesskit-notices.mjs` regenerates those). Staging fails
when a linked component has no notice. JUCE is never part of an archive.
Distributing a plugin means distributing these notices with it.

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
