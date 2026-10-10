# three-benchmark

Unmodified [Three.js](https://threejs.org) (`three` from npm) on a Soundor
canvas, as a benchmark: the same code in the JUCE runtime (WebGL 2 on ANGLE,
composited on the GPU without copies) and in the browser.

```text
soundor.config.ts   identity, a `gain` parameter, both runtimes
src/scenes.ts       the scenes: plain Three.js
src/main.tsx        the UI: scene picker, live statistics, "Run all"
scripts/bench.ts    `pnpm bench`: the headless benchmark in the JUCE runtime
runtimes/juce/      JUCE (C++): applies `gain`
runtimes/web/       Web (TypeScript): applies `gain` with a GainNode
```

| Scene     | Stresses                                                              |
| --------- | --------------------------------------------------------------------- |
| Meshes    | 2,000 separate meshes: draw calls                                     |
| Instanced | 50,000 instances whose matrices change every frame                    |
| Lit       | Physical materials, two shadow maps, a PMREM environment              |
| Particles | 200,000 points moved on the CPU every frame                           |
| Post      | Meshes into a multisampled half-float target, then a full-screen pass |

The statistics are frames per second, the CPU time of each frame's
`update()` and `render()` (average and 95th percentile), and Three's draw
calls and triangles. GPU time is not measured: the GPU works asynchronously.

## Running it

```sh
pnpm dev:web     # in the browser, at http://localhost:5173
pnpm dev         # in the JUCE plugin (Standalone)
```

"Run all" runs each scene for 120 frames after 30 frames of warm-up, then
shows a table and logs it (`soundor-three-benchmark [...]`).
`globalThis.soundorBenchmark.run(frames, warmup)` does the same from code.

## Benchmarking

`pnpm bench` measures the JUCE runtime headless, without building the
plugin: it builds the UI bundle and `soundor_run_ui` (a Release build, the
`bench` preset of `runtimes/juce-runtime/native`), runs every scene 5 times
and prints the median of each measure with its spread across runs:

| Measure                            | What it is                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------- |
| frame ms, p95, fps                 | time from one composited frame to the next, as fast as frames come          |
| tick                               | `RuntimeHost::tick()`: the UI's JavaScript and the WebGL calls it makes     |
| build                              | `RuntimeHost::frame()`: layout, CPU rasterization, layers                   |
| composite                          | the GPU compositor's work on the CPU                                        |
| update, render                     | the scene's `update()`, and Three's `render()` with its WebGL calls (in JS) |
| read-backs, rasterized, uploaded/f | per frame: GPU read-backs, CPU layers rasterized, KB sent to the GPU        |

All are CPU times: nothing waits for the GPU. The counts do not depend on
timing (the live statistics update every 15 frames, not on a clock), so any
change in them is real.

To see what a change does, compare it with a saved build, run alternately in
the same session:

```sh
pnpm bench --save main       # on main: also keeps this build as "main"
pnpm bench --against main    # on your branch: both builds, run in turn
pnpm bench --against main --check   # exits with 1 if anything got worse
```

Only differences larger than both sides' spread (and 3%, `--threshold`, for
timings) are marked. Comparing with an earlier session's report
(`--baseline <report.json>`) works too, but a machine drifts by several
percent between sessions, so trust only large differences there. Every run's
report is kept in `.soundor/bench/`. Other options: `--runs`, `--frames`,
`--warmup`, `--size`, `--backend vulkan|opengl|metal|d3d11`, `--software`
(allow a software GPU), `--no-build`.

Under the hood, `soundor_run_ui` runs a bundle on the GPU like the editor
would, and times its frames, per scene (the benchmark names each measured
scene in `globalThis.soundorRunUiPhase`):

```sh
pnpm build:web   # also bundles the UI into .soundor/ui/production
../../runtimes/juce-runtime/native/build/bench/tests/soundor_run_ui \
  .soundor/ui/production --size 700x480 --eval 'soundorBenchmark.run()' --json report.json
```
