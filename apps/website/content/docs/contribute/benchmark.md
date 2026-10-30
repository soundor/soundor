---
title: 'Benchmarks'
description: 'Headless scenarios, comparable baselines, work counters, and animation workloads.'
---

Source: [`tools/benchmark/`](https://github.com/soundor/soundor/tree/main/tools/benchmark).

Run this page’s package-local commands from `tools/benchmark/`, unless noted otherwise.

Rendering scenarios for Soundor, the same code in the JUCE runtime (Hermes,
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
`bench` preset of `runtimes/engine`), runs the scenarios for 600 measured frames after 30 warmup frames, 5 times
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
invalidations, CPU layers rasterized, KB uploaded to the GPU, GPU read-backs,
and Three's draw calls. Also the engine's allocations (blocks over 512 bytes
and the engine's arenas, and their KB): these depend on the heap they are
made in, and so on the scenarios that ran before, and are shown but not
compared. During a run of scenarios ("Run all", `pnpm bench`) the live
statistics do not update, so what the view draws depends on the scenario
alone.

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

The bundle runs as a built plugin runs it: compiled to Hermes bytecode by the
same build's `hermesc` (`build/bench/soundor-compile-js.cmake`). `--source`
runs its JavaScript source instead, as `soundor dev` does. A build saved
before Hermes (QuickJS bytecode, `bundle.js.qjsbc`) runs as it was saved, so
`--against` compares the engines too. The engine's work counts differ between
them: Hermes reports garbage collections (GCs) and the bytes its heap
allocated, QuickJS reported C allocator calls and their bytes. Each run also reports startup: how long the
runtime took to start and run the bundle, and the engine's heap after it.

Under the hood, `soundor_run_ui` runs a bundle on the GPU like the editor
would, and times its frames, per scenario (the driver names each measured
scenario in `globalThis.soundorRunUiPhase`):

```sh
pnpm build:web   # also bundles the UI into .soundor/ui/production
# Lowers it into the engine's module form, as the JUCE runtime does.
node ../../runtimes/engine/cmake/SoundorLowerJs.mjs \
  .soundor/ui/production/bundle.mjs .soundor/ui/production/bundle.js
../../runtimes/engine/build/bench/tests/soundor_run_ui \
  .soundor/ui/production --size 700x520 --eval 'soundorBenchmark.run()' \
  --time-native-calls --json report.json
```

## Animation baselines

The `animation` group adds opacity and React workloads at 1, 50 and 500
nodes, plugin controls at 1, 20 and 50 controls, matching static plugin
views, and a mixed 20-control view with Canvas 2D and WebGL 2. Each control
contains a knob, slider, meter, fading panel and numeric readout; these are
visual smoothing workloads, with no parameter processing or DSP. The mixed
view draws its waveform and WebGL background once during setup: per-frame
animation does not change that content.

Animation inputs advance by exactly 1/60 second per scenario frame, including
warmup, rather than by wall time. Ramps alternate linearly between endpoints
over one second in each direction, with deterministic offsets (index modulo
10). Opacity endpoints are 0.25 and 1. The stage is always 640×360 logical
pixels; the runner defaults to a 700×520 viewport. Complexity is selected by
scenario id. These definitions must remain identical in native comparisons.
The existing scenarios retain their wall-clock behavior.

```sh
pnpm --filter soundor-benchmark test
pnpm --filter soundor-benchmark bench --only animation --backend opengl --save hermes-animation
pnpm --filter soundor-benchmark bench --only animation --backend opengl --against hermes-animation
```

Defaults are five runs, 30 warmup frames and 600 measured frames per scenario.
P99 is a sample percentile, not a guarantee; increase `--frames` for tail
analysis. The driver preserves every measured sample, even beyond 600 frames.
Reports include native frame mean, P50, P95, P99, maximum and population
standard deviation. Existing saved runners lacking P99/variability display
those values as unavailable. Throughput is uncapped headless throughput,
not display refresh rate. Composite timings measure CPU submission and
uploads, not GPU execution time. Startup is reported separately.

Each report and saved build records the full repository SHA, dirty state,
Hermes revision from the configured compiler script, compiler/runner/bundle
SHA-256 fingerprints, Release build type and source/bytecode execution mode.
`--save` copies the runner and already compiled bytecode together; the saved
bundle is never recompiled with the candidate's compiler. Keep this local
saved build for alternating baseline/candidate measurements. Record a clean
commit when saving a baseline used in a PR. Reports also record OS, CPU,
core count, graphics backend, renderer, software rendering and all measurement
options. Report-file comparisons refuse different machines/backends or sample
settings. Use the same backend and viewport for alternating runs too.

Native call counts/timings, style changes, layouts, invalidations, rasterized
layers, uploads/readbacks and Hermes allocation/collection statistics reuse
the existing instrumentation. Scenario JS time includes synchronous React
reconciliation and native updates; native binding time is separately measured,
but React reconciliation is not independently instrumented. Engine heap is
measured; it is not whole-process resident memory. Static scenarios may render
no frames and therefore report idle tick cost instead of a frame distribution.
No extra hot-path animation instrumentation is enabled in normal plugins.

Transforms are absent from the current public style contract. Their JS baseline
cannot yet be measured; PR 1 must add a comparable fixed-step workload when it
introduces transforms. No transform feature is added by these benchmarks.
Startup uses the existing static UI rather than a discarded Three.js scene,
so its later GPU resource collection cannot contaminate animation-only runs.
Stage changes happen on unmeasured ticks. The runner collects garbage and
drains finalizers once at each phase boundary (`--collect-between-phases`),
before resetting timing/counter baselines. This prevents detached stages'
node-release calls from polluting later workloads. GC caused by measured
work remains included. Saved builds record this policy; older runners are
not passed an unsupported flag. CI runs deterministic driver tests
and a native bytecode smoke run without an FPS threshold. GPU measurements
require verifying the actual selected device; sandboxed runs may hide `/dev/dri`
and select software rendering even when the host has a virtual GPU.

### Recorded Hermes baseline

[Machine-readable baseline](https://github.com/soundor/soundor/blob/main/tools/benchmark/reports/hermes-animation.json), source commit
`629fca5f447ca4dad6a86c9cad9fe2a911e5c69d`, Hermes
`602befee340da188ea1560cde7a9cc33e6b180dc`: Linux 7.0.0-38-generic,
Intel Core 5 210H (4 available cores), OpenGL/ANGLE through virgl on an
NVIDIA RTX 4050 Laptop GPU, Mesa 25.2.8. Release, Hermes bytecode, five runs,
600 measured frames after 30 warmup frames, 700×520 viewport. Phase-boundary
GC/cleanup is excluded; steady-state GC is included. CPU/compositor timings
are the median across runs of each run's statistic.

| Scenario              | Frame mean ms | P95 ms | P99 ms | JS ms | UI calls/frame | Yoga/frame | Uploaded KB/frame |
| --------------------- | ------------: | -----: | -----: | ----: | -------------: | ---------: | ----------------: |
| animation-opacity-50  |         0.551 |  0.742 |  0.938 | 0.210 |         50.000 |      0.000 |           100.000 |
| animation-opacity-500 |         3.113 |  3.441 |  8.887 | 2.035 |        500.000 |      0.000 |           800.000 |
| animation-react-500   |         9.101 | 10.490 | 15.878 | 7.768 |        500.000 |      0.000 |           800.000 |
| animation-mixed-20    |         4.554 |  4.991 | 11.146 | 1.796 |         84.000 |      1.000 |           474.366 |

All four rasterize one CPU layer per intermediate frame and perform zero
GPU readbacks. Static counterparts make no intermediate frames and cost
idle ticks instead. The full report includes allocation/collection counts,
peak engine heaps, per-run spreads and all other workloads. The saved
`hermes-animation` runner and its matching bytecode remain local for PR 1
comparisons; re-run them alternately with a candidate rather than treating
these timings as a machine-independent target. No native-animation
improvement is claimed by this baseline alone.

## Comparing native timing animations

```sh
pnpm --filter soundor-benchmark bench --animations native --against hermes-animation --only animation --backend opengl
pnpm --filter soundor-benchmark bench --animations js --only animation-transform-1,animation-transform-50,animation-transform-500 --backend opengl --save transform-js
pnpm --filter soundor-benchmark bench --animations native --only animation-transform-1,animation-transform-50,animation-transform-500 --backend opengl --against transform-js
```

Keep the PR 0 `hermes-animation` saved build intact. Native comparisons require
matching Hermes revision, compiler and execution mode and alternate the saved
runner/bundle with the candidate on the same device. Native time advances by
exactly 1000/60 ms per driver tick, preserving the PR 0 simulation inputs.
The unchanged opacity, React-mounted control, plugin and mixed workloads use
native interpolation; one JS completion submission per second reverses the ramp.
This measures zero intermediate React reconciliation for the React-mounted
workload; plugin knobs, slider widths, meters and readouts keep their existing JS
updates because they require layout/text changes. Canvas/WebGL content stays
static. Static scenarios use the original rendering path.

New `animation-transform-{1,50,500}` workloads compare the same translateY/scale
ramps within PR 1. PR 0 had no public transforms, so there is no PR 0 transform
baseline. Do not attribute Hermes migration gains to native animations.
Reports include native timeline CPU time and peak cached CPU raster bytes, alongside
frame tails, JS, bindings, layout, raster and CPU-side composition. Missing metrics
from the saved runner remain unavailable. Cache bytes exclude composition targets,
GPU physical memory and allocator overhead; uncapped throughput is not display FPS.

Recorded PR 1 measurements and tradeoffs: [native timing comparison](https://github.com/soundor/soundor/blob/main/tools/benchmark/reports/native-timing.md).

## Advanced animation workloads

The `advanced-animation` group extends the same Hermes-bytecode, fixed-step
Release runner. It is hidden from the toolbar so the PR 0/1 surrounding UI and
node counts remain unchanged. Each JS/native pair has identical nodes, endpoints,
physics, duration, viewport and background content. The group includes 50/500
springs, 400 ms spring interruption/retargeting, parallel opacity/transforms,
native repetition, four keyframes, paint colors, and 1000-phase sequences on
1/50 nodes (20 ms per phase). The JS spring reference uses the same analytic
solution and settling thresholds as the browser/native implementation; there
is no DSP work.

```sh
pnpm --filter soundor-benchmark bench --only advanced-animation --backend opengl --save advanced-js
pnpm --filter soundor-benchmark bench --only advanced-animation --animations native --backend opengl --against advanced-js --save advanced-native
pnpm --filter soundor-benchmark bench --only animation --animations native --backend opengl --against native-timing
pnpm --filter soundor-benchmark bench --only ui,canvas --backend opengl --against native-timing
```

Preserve saved `hermes-animation` and `native-timing` builds. Their runner,
bytecode and matching compiler/runtime metadata are retained; comparisons run
baseline and candidate alternately in the same session. New `allTickMs`
(mean/P95/P99) includes idle ticks, which matter when an opacity spring overshoots
and clamps at one. Existing frame distributions describe rendered frames;
`frames + idleTicks` accounts for every measured tick. Work-per-rendered-frame
counts retain the existing format and can include preceding idle-tick work.
Do not interpret a clamped plateau as a missing measurement or display FPS.

`animationStorageBytesAtStart` queries C++ record and owned vector capacity once
after warmup, outside timed frames. It includes compiled phases, copied
keyframes, per-property tracks, target snapshots and playback vectors. It
excludes allocator metadata, hash-table bucket/node overhead, source-code/JS
objects, raster caches and physical GPU memory, and is an estimate of owned
storage rather than RSS or a high-water mark. The query adds no production
per-frame work. Deterministic sequence tests check unchanged owned capacity
across phase transitions; there is no general heap-allocation profiler in this
runner. Forward transitions only finalize departed phases; reverse/seek/repeat
can reconstruct preceding endpoints. Long sequences therefore use more setup
memory and can do more native work than a simple timing animation.

Paint uses the ordinary damage/raster/upload path. Opacity/transforms retain
cached content, and their intermediate native frames have no UI bridge calls,
style mutations, Yoga passes, rasterizations or texture uploads. Retargeting
submits only on each 400 ms target change. CPU-side compositor time is measured;
GPU execution time, process RSS and GPU VRAM are not. Native timings and
regressions must be read alongside sample counts, idle ticks and work counts.

The [recorded advanced results](https://github.com/soundor/soundor/blob/main/tools/benchmark/reports/advanced-native.md) include matched Hermes
comparisons, P95/P99, storage estimates and rendering/kernel regressions.
