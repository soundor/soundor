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
    js/                   the QuickJS-NG wrapper and the binding helpers generated
                          code uses; the only place quickjs.h is included
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
  backend/juce/           JUCE adapters, compiled into the plugin (they need JUCE)
  tests/                  doctest suites + the exported-symbol check
    generated/            golden soundor:native output, compiled by the tests
  cmake/                  pinned dependencies, compiler policy, JS embedding,
    angle/                building ANGLE: DEPS checkout, gn → CMake, its project
```

A third-party header (QuickJS, Yoga, Skia) is only included by the directory
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

Beyond views and text there are the primitives a plugin UI is made of:

- **`createImage(asset, style)`:** a bundled image (PNG, JPEG or WebP). It is
  sized by its pixels unless styled; `resizeMode` is `cover`, `contain`,
  `stretch` or `center`.
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
    does and makes one native call per method.
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
    (`webglCall(id, op, …)`). Methods whose arguments are only numbers,
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
    `KHR_parallel_shader_compile`, `OES_texture_float_linear`,
    `WEBGL_debug_renderer_info` and `WEBGL_lose_context`.
  - **Objects** live until deleted, or until their context goes. Dropping a
    wrapper does not delete the OpenGL object, because OpenGL keeps it in
    use while it is bound.
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
[`src/a11y/apple/README.md`](src/a11y/apple/README.md).

### `RuntimeHost`

`RuntimeHost` is what a backend creates per plugin view: a runtime and context
with `soundor:parameters` and the generated `soundor:native` installed. The
backend calls `tick()` from its UI thread every frame. The generated JUCE editor
owns one and ticks it from a 60 Hz `juce::Timer`. Its processor supplies the
`soundor:native` implementation by overriding `createNativeApi()`. Each host
has its own `ui::Surface` (`surface()`). The editor sizes it every frame and
forwards mouse, wheel and keyboard input to it, then runs pending jobs.

`RuntimeHost` also loads the plugin's UI. Given `platform::Resources` (the UI
bundle compiled in with `soundor_embed_directory()`, or a directory in
development) and an entry such as `/bundle.js`, it evaluates the entry after
installing the modules. A failing entry is logged and leaves the host usable.
`RuntimeHost::asset(id)` returns the bytes of a bundled image.
`RuntimeHost::frame()` renders the view for a compositor (see "Rendering").
`Options::gpuDevice` is the device canvases' WebGL contexts use (see "WebGL"),
and `tick()` shows what they drew.

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

The engine heap is released once the `Runtime` and all of its `Context`s are
destroyed, in any order. Destroying everything and creating fresh instances is
the supported reload path. Tests cover repeated create/destroy and teardown with
jobs and rejections still pending. Debug builds of QuickJS abort if anything
leaks at teardown.

## Dependencies

All dependencies are fetched by CMake (`FetchContent`) from exact revisions,
verified by SHA-256, and built privately. See `cmake/SoundorDependencies.cmake`.

| Dependency  | Version             | License          | Role                                                     |
| ----------- | ------------------- | ---------------- | -------------------------------------------------------- |
| QuickJS-NG  | v0.17.0 (`6d46d07`) | MIT              | JavaScript engine (shipped)                              |
| ada         | v3.4.4 (`8d50724`)  | MIT / Apache-2.0 | WHATWG URL parser (shipped, ~370 KB stripped)            |
| Yoga        | v3.2.1 (`042f501`)  | MIT              | flexbox layout (shipped)                                 |
| Skia        | m144 (`ed427fd`)    | BSD-3-Clause     | 2D rendering (shipped; built from source)                |
| ANGLE       | M151 (`7e08726`)    | BSD-3-Clause     | OpenGL ES 3 on the GPU (shipped; built from source)      |
| accesskit-c | 0.23.1              | MIT / Apache-2.0 | Windows/Linux accessibility (shipped; official prebuilt) |
| doctest     | v2.5.3 (`2d0a935`)  | MIT              | test framework (tests only)                              |

QuickJS-NG's own CMake project is not used. Soundor compiles the four engine
sources into a static `soundor_quickjs` target with hidden visibility and links
it `PRIVATE`. This leaves out `quickjs-libc` (file/process access), the `qjs`/`qjsc`
executables and the install rules, and keeps `quickjs.h` off consumers' include
paths. To build offline, set `FETCHCONTENT_SOURCE_DIR_SOUNDOR_QUICKJS` to a
checkout of the same revision.

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
  `soundor::SOUNDOR_ABI_NAMESPACE`. The default is `v0`. A plugin build will set it
  from a stable hash of the plugin identifier, so mangled names differ between
  plugins while source code keeps writing `soundor::js::Context`.
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
  creates a GPU device and context, so QuickJS, ada, Yoga, Skia and its
  codecs, and ANGLE are all linked into what is checked. A future ANGLE
  update that introduced an Objective-C class or category, or an exported
  EGL or GL symbol, fails the build.

## Coexistence

Plugins built with Soundor must run side by side in one host process, each
with its own copy of the runtime. Two tests prove it:

- **`soundor_coexistence` (CTest, every platform in CI).** It builds the
  runtime twice, under the ABI namespaces `v0` and `p_coexist`, into two
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

Measured with `examples/basic` (React UI) on Linux x64, Release:

| What                                                       | Size / time                       |
| ---------------------------------------------------------- | --------------------------------- |
| VST3 binary, stripped (QuickJS, ada, Yoga, Skia, JUCE, UI) | 11.1 MB                           |
| …of which Skia with its codecs                             | ~4.6 MB                           |
| UI bundle (React, react-reconciler, scheduler, app)        | 153 KB minified                   |
| Editor start to first frame (host, bundle, React, render)  | ~20 ms at 1600×1200 device pixels |
| A full redraw after that                                   | ~0.6 ms                           |

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
does not run them; run them wherever JUCE is installed, for example the
two-plugin host test:

```sh
cmake -S . -B build/juce -DSOUNDOR_JUCE_TESTS=ON -DJUCE_DIR=/path/to/JUCE \
  -DSOUNDOR_COEXISTENCE_PLUGINS="/path/A.vst3;/path/B.vst3"
cmake --build build/juce && (cd build/juce && xvfb-run -a ctest -R coexistence)
```

Requires CMake ≥ 3.25 for the presets (the library itself needs 3.22) and a
C++20 compiler. CI builds with Clang 18 and GCC on Linux, Apple Clang on macOS,
and MSVC on Windows, and runs the sanitizer preset on Linux.
