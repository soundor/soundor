# Soundor native runtime

The C++ side of Soundor's embedded JavaScript runtime: the engine that will run
a plugin's UI JavaScript on the UI/message thread. DSP stays native and never
touches JavaScript.

This library is **backend-independent**: it does not include JUCE, so it builds
and tests without a plugin host. JUCE adapters will live in separate targets on
top of it.

> Status: the engine, module loading, the Web platform layer, and the
> `soundor:native`, `soundor:parameters`, `soundor:host`, `soundor:storage` and
> `soundor:fs` modules are in place and tested, and JUCE plugins host a runtime
> per plugin view. Loading the plugin's own JavaScript bundle comes next.

## Layout

```text
native/
  include/soundor/        public headers: plain C++, no engine types
    Config.h              the ABI namespace (see "Symbol isolation")
    js/                   Runtime, Context, Value, Error, ModuleLoader, Promise
    parameters/           the parameter Host interface backends implement
    platform/             HttpClient and HostInfo, the services backends provide
    runtime/              RuntimeHost: one plugin view's JavaScript world
  src/
    js/                   the QuickJS-NG wrapper and the binding helpers generated
                          code uses; the only place quickjs.h is included
    modules/              soundor:* modules (C++, plus embedded JavaScript)
    platform/             background worker and UI-thread handoff queue
    runtime/              RuntimeHost
    web/                  the Web-compatible globals (C++ + embedded JavaScript)
  backend/juce/           JUCE adapters, compiled into the plugin (they need JUCE)
  tests/                  doctest suites + the exported-symbol check
    generated/            golden soundor:native output, compiled by the tests
  cmake/                  pinned dependencies, compiler policy, JS embedding
```

A later stage adds `ui/` (UI tree, layout, rendering) as a sibling directory. A third-party header (QuickJS, later Yoga and Skia) is only
included by the directory that wraps it.

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

- **Runtime**: one QuickJS-NG engine: a heap, a job queue, memory and stack limits.
- **Context**: one realm (global object and module map). A new context contains
  the ECMAScript language and nothing else. There is no `console`, timers,
  `window`, `self`, `process`, `require`, `performance` or `atob`, and none of
  QuickJS's own `std`/`os` modules. The Web platform layer installs a
  deliberate subset later.
- **Errors**: JavaScript exceptions come back as `Result<T>` holding a
  `soundor::js::Error` (`name`, `message`, `stack`). No C++ exception crosses the
  engine boundary: exceptions thrown by module loaders or native-module code
  become JavaScript errors.
- **Jobs**: promise jobs run only when `Runtime::runPendingJobs()` is called. After
  the queue drains, rejections nobody handled are reported to the log sink.
  `evaluateModule` drains jobs itself, so top-level `await` settles.

### Module resolution

Soundor resolves every import; the engine never touches the filesystem.

- `soundor:*` specifiers are reserved for runtime-provided native modules. They
  resolve inside the `Context` and never reach the loader. An unregistered one
  fails with `Unknown Soundor module`.
- Everything else goes to the context's `ModuleLoader`. The built-in
  `MemoryModuleLoader` serves a bundled plugin. It resolves relative and absolute
  paths and rejects bare specifiers (`react`, `node:fs`, `qjs:std`), because npm
  packages are bundled at build time, not resolved at runtime.

Native modules use a private registration API (`src/js/NativeModule.h`), and
generated bindings are written against the helpers in `src/js/Bindings.h`.

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
  `std::shared_ptr`. They cannot be forged or confused between types. The C++
  object is released when JavaScript drops the handle, or when the runtime is
  torn down.
- **Errors.** A C++ exception from a method becomes a JavaScript `Error`
  (`"fail(): disk full"`). Nothing unwinds into the engine.
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
| `atob`, `btoa`, `DOMException`                                         | From QuickJS-NG.                                                                                                                                                                                              |
| `structuredClone`                                                      | Including `transfer`. Functions, symbols and similar values throw `DataCloneError`.                                                                                                                           |
| `crypto.getRandomValues()`, `crypto.randomUUID()`                      | From the OS CSPRNG. `crypto.subtle` is not provided.                                                                                                                                                          |
| `fetch`, `Headers`, `Request`, `Response`, `Blob`, `File`, `FormData`  | Through the backend's `HttpClient`. Bodies are buffered (no Web Streams yet). `data:` URLs resolve locally; redirects are always followed.                                                                    |

Not provided: the DOM, Canvas/WebGL, Workers, IndexedDB/`localStorage`,
`XMLHttpRequest`, WebSocket, Web Streams, WebAudio.

Anything that would block, such as network or file I/O, is asynchronous. Work
runs on backend or worker threads and carries only an operation id and plain
C++ results back. The UI thread settles the promise in `tick()`. A runtime torn
down mid-operation is therefore safe: in-flight requests are cancelled, file
writes already started complete, and late results are dropped.

### `soundor:host`, `soundor:storage`, `soundor:fs`

```ts
import { plugin, snapshot, subscribe } from 'soundor:host';
import { storage } from 'soundor:storage';
import { readText, writeText } from 'soundor:fs';

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

### `RuntimeHost`

`RuntimeHost` is what a backend creates per plugin view: a runtime and context
with `soundor:parameters` and the generated `soundor:native` installed. The
backend calls `tick()` from its UI thread every frame. The generated JUCE editor
owns one and ticks it from a 60 Hz `juce::Timer`. Its processor supplies the
`soundor:native` implementation by overriding `createNativeApi()`.

`RuntimeHost` also loads the plugin's UI. Given `platform::Resources` (the UI
bundle compiled in with `soundor_embed_directory()`, or a directory in
development) and an entry such as `/bundle.js`, it evaluates the entry after
installing the modules. A failing entry is logged and leaves the host usable.
`RuntimeHost::asset(id)` returns the bytes of a bundled image.

### Threading and lifetime

A `Runtime` and its `Context`s belong to the thread that created the runtime: the
UI/message thread. Debug builds assert this. Background work must hand results
back to that thread before touching JavaScript.

The engine heap is released once the `Runtime` and all of its `Context`s are
destroyed, in any order. Destroying everything and creating fresh instances is
the supported reload path. Tests cover repeated create/destroy and teardown with
jobs and rejections still pending. Debug builds of QuickJS abort if anything
leaks at teardown.

## Dependencies

All dependencies are fetched by CMake (`FetchContent`) from exact revisions,
verified by SHA-256, and built privately. See `cmake/SoundorDependencies.cmake`.

| Dependency | Version             | License          | Role                                          |
| ---------- | ------------------- | ---------------- | --------------------------------------------- |
| QuickJS-NG | v0.17.0 (`6d46d07`) | MIT              | JavaScript engine (shipped)                   |
| ada        | v3.4.4 (`8d50724`)  | MIT / Apache-2.0 | WHATWG URL parser (shipped, ~370 KB stripped) |
| doctest    | v2.5.3 (`2d0a935`)  | MIT              | test framework (tests only)                   |

QuickJS-NG's own CMake project is not used. Soundor compiles the four engine
sources into a static `soundor_quickjs` target with hidden visibility and links
it `PRIVATE`. This leaves out `quickjs-libc` (file/process access), the `qjs`/`qjsc`
executables and the install rules, and keeps `quickjs.h` off consumers' include
paths. To build offline, set `FETCHCONTENT_SOURCE_DIR_SOUNDOR_QUICKJS` to a
checkout of the same revision.

## Symbol isolation

Several Soundor plugins can be loaded into one host process, so nothing Soundor
or its dependencies define may be exported from a plugin binary:

- Everything is compiled with hidden visibility (`-fvisibility=hidden`,
  `-fvisibility-inlines-hidden`) and linked statically.
- Every Soundor C++ symbol lives in the inline namespace
  `soundor::SOUNDOR_ABI_NAMESPACE`. The default is `v0`. A plugin build will set it
  from a stable hash of the plugin identifier, so mangled names differ between
  plugins while source code keeps writing `soundor::js::Context`.
- The `soundor_exported_symbols` test links the runtime into a plugin-shaped
  shared library and fails if it exports anything but its own entry point.
  Standard-library template instantiations are tolerated, because `std` headers
  force default visibility on them. A negative-control test proves the check
  catches a leaked symbol. The check runs on Linux and macOS.

## Building and testing

From the repository root:

```sh
pnpm test      # includes the native tests (the `dev` preset)
pnpm lint      # includes clang-tidy (the `tidy` preset)
pnpm format    # includes clang-format 18 over these sources
pnpm check     # format + lint + build + test
```

Or directly, from this directory:

```sh
cmake --workflow --preset dev        # Debug, -Werror, tests
cmake --workflow --preset sanitize   # + AddressSanitizer / UBSan / LeakSanitizer
cmake --workflow --preset tidy       # + clang-tidy (build only)
JUCE_DIR=/path/to/JUCE cmake --workflow --preset juce   # + JUCE adapter tests
```

The JUCE adapter tests need a JUCE checkout. JUCE is never downloaded, so CI
does not run them; run them wherever JUCE is installed.

Requires CMake ≥ 3.25 for the presets (the library itself needs 3.22) and a
C++20 compiler. CI builds with Clang 18 and GCC on Linux, Apple Clang on macOS,
and MSVC on Windows, and runs the sanitizer preset on Linux.
