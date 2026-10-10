# soundor-benchmark

Rendering scenarios for Soundor, the same code in the JUCE runtime (QuickJS,
Skia, WebGL 2 on ANGLE, the GPU compositor) and in the browser: WebGL through
Three.js (the expensive way and the GPU way) and raw calls, Canvas 2D, UI
updates through React and `soundor:ui`, and a plugin-like mix. `pnpm bench`
measures them headless in the JUCE runtime.

```text
soundor.config.ts       identity, a `gain` parameter, both runtimes
src/main.tsx            the UI: groups, scenarios, live statistics, "Run all"
src/driver.ts           runs scenarios one at a time and measures their frames
src/scenarios/          the scenarios, one file per kind (types.ts: what one is)
scripts/bench.ts        `pnpm bench`: the headless benchmark in the JUCE runtime
runtimes/juce/          JUCE (C++): applies `gain`
runtimes/web/           Web (TypeScript): applies `gain` with a GainNode
```

| Group          | Scenario                     | Stresses                                                          |
| -------------- | ---------------------------- | ----------------------------------------------------------------- |
| `webgl-stress` | `meshes`                     | 2,000 separate meshes: draw calls                                 |
|                | `instanced`                  | 50,000 instance matrices written by JavaScript per frame: uploads |
|                | `lit`                        | physical materials, two shadow maps, a PMREM environment          |
|                | `particles`                  | 200,000 points moved by JavaScript per frame                      |
|                | `post`                       | meshes into a multisampled half-float target, a full-screen pass  |
| `webgl`        | `gpu-particles`              | `particles`, moved by the vertex shader                           |
|                | `gpu-instanced`              | `instanced`, placed by the vertex shader                          |
|                | `webgl-calls`                | 6,000 raw WebGL calls per frame (Meshes' pattern, no Three.js)    |
| `canvas`       | `waveform-1k`, `-5k`, `-10k` | one path of 1,000 to 10,000 points per frame                      |
|                | `canvas-complex`             | bars, knobs, curves, clips, text and state changes                |
| `ui`           | `react-100`, `-500`, `-1000` | React re-rendering a grid whose every cell changes                |
|                | `style-opacity`              | 500 nodes' `style.opacity` set directly: paint only               |
|                | `style-height`               | 500 nodes' `style.height` set directly: layout                    |
|                | `static`                     | 330 nodes, nothing changes: frames should find nothing to do      |
| `mixed`        | `mixed`                      | a readout, 8 canvas knobs, meters, a waveform and a 3D view       |

`webgl-stress` is the worst case on purpose: per-frame work in JavaScript.
The `webgl` versions show what a plugin should do instead: give the GPU the
per-frame work (a shader and a time uniform), so JavaScript only sets the
uniform. Compare `particles` with `gpu-particles`.

## Running it

```sh
pnpm dev:web     # in the browser, at http://localhost:5173
pnpm dev         # in the JUCE plugin (Standalone)
```

"Run all" runs each scenario for 120 frames after 30 frames of warm-up, then
shows a table and logs it (`soundor-benchmark [...]`).
`globalThis.soundorBenchmark.run(frames, warmup, only)` does the same from
code; `only` lists groups or scenario ids.

## Benchmarking

`pnpm bench` measures the JUCE runtime headless, without building the
plugin: it builds the UI bundle and `soundor_run_ui` (a Release build, the
`bench` preset of `runtimes/juce-runtime/native`), runs the scenarios 5 times
and prints the median of each measure with its spread across runs, in two
tables.

**Time per frame** (milliseconds). All are CPU times: nothing waits for the
GPU.

| Measure            | What it is                                                                  |
| ------------------ | --------------------------------------------------------------------------- |
| frame ms, p95, fps | from one composited frame to the next, as fast as frames come               |
| tick               | `RuntimeHost::tick()`: the UI's JavaScript and the native calls it makes    |
| build              | `RuntimeHost::frame()`: layout, CPU rasterization, layers                   |
| composite          | the GPU compositor's work on the CPU (uploads included)                     |
| JS                 | the scenario's frame function (React updates flushed in it)                 |
| update, render     | of which the scene's own `update()`, and Three's `render()` (Three.js only) |
| native calls       | time inside native `soundor:ui`, Canvas 2D and WebGL calls                  |
| layout             | Yoga                                                                        |
| idle tick          | a tick that renders nothing, per such tick (what a UI that is still costs)  |

**Work per frame** (counts, which do not depend on timing, so any change in
them is real): native calls by API, style changes, layout passes,
invalidations, engine allocations (blocks over 512 bytes and the engine's
arenas, and their KB), CPU layers rasterized, KB uploaded to the GPU, GPU
read-backs, and Three's draw calls.

JS minus native calls is JavaScript's own time: in `webgl-calls`, what the
WebGL wrappers cost per call; in `meshes`, mostly Three's own code.

To see what a change does, compare it with a saved build, run alternately in
the same session:

```sh
pnpm bench --save main       # on main: also keeps this build as "main"
pnpm bench --against main    # on your branch: both builds, run in turn
pnpm bench --against main --check   # exits with 1 if anything got worse
pnpm bench --only ui,canvas  # some groups or scenarios
```

Only differences larger than both sides' spread (and 3%, `--threshold`, for
timings; 1% for counts) are marked. Comparing with an earlier session's
report (`--baseline <report.json>`) works too, but a machine drifts by several
percent between sessions, so trust only large differences there. Every run's
report is kept in `.soundor/bench/`. Other options: `--runs`, `--frames`,
`--warmup`, `--size`, `--backend vulkan|opengl|metal|d3d11`, `--software`
(allow a software GPU), `--no-build`.

**Virtual machines:** measure on a backend whose uploads are not the
bottleneck. With Mesa's Venus (Vulkan in a virtio-gpu VM) on an NVIDIA host,
uploading a 640×360 canvas took about 38 ms (0.2 ms through virgl's OpenGL
and on lavapipe), which hides everything else: use `--backend opengl` there.

Under the hood, `soundor_run_ui` runs a bundle on the GPU like the editor
would, and times its frames, per scenario (the driver names each measured
scenario in `globalThis.soundorRunUiPhase`):

```sh
pnpm build:web   # also bundles the UI into .soundor/ui/production
../../runtimes/juce-runtime/native/build/bench/tests/soundor_run_ui \
  .soundor/ui/production --size 700x520 --eval 'soundorBenchmark.run()' \
  --time-native-calls --json report.json
```
