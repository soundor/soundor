# Soundor native runtime

The C++ side of Soundor's embedded JavaScript runtime: the engine that will run
a plugin's UI JavaScript on the UI/message thread. DSP stays native and never
touches JavaScript.

This library is **backend-independent**: it does not include JUCE, so it builds
and tests without a plugin host. JUCE adapters will live in separate targets on
top of it.

> Status: the engine, contexts, error conversion, job pumping, module loading
> and generated `soundor:native` bindings are in place and tested. The plugin
> does not host the runtime yet.

## Layout

```text
native/
  include/soundor/        public headers: plain C++, no engine types
    Config.h              the ABI namespace (see "Symbol isolation")
    js/                   Runtime, Context, Value, Error, ModuleLoader, Promise
  src/
    js/                   the QuickJS-NG wrapper and the binding helpers generated
                          code uses; the only place quickjs.h is included
  tests/                  doctest suites + the exported-symbol check
    generated/            golden soundor:native output, compiled by the tests
  cmake/                  pinned dependencies, compiler policy
```

Later stages add sibling directories rather than growing `js/`: `web/` (Web API
implementations), `modules/` (`soundor:*` modules), `ui/` (UI tree, layout,
rendering), `backend/` (JUCE adapters) and `generated/` (code generated from the
Soundor config). A third-party header (QuickJS, later Yoga and Skia) is only
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

| Dependency | Version             | License | Role                        |
| ---------- | ------------------- | ------- | --------------------------- |
| QuickJS-NG | v0.17.0 (`6d46d07`) | MIT     | JavaScript engine (shipped) |
| doctest    | v2.5.3 (`2d0a935`)  | MIT     | test framework (tests only) |

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
```

Requires CMake ≥ 3.25 for the presets (the library itself needs 3.22) and a
C++20 compiler. CI builds with Clang 18 and GCC on Linux, Apple Clang on macOS,
and MSVC on Windows, and runs the sanitizer preset on Linux.
