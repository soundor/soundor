# three-benchmark

Unmodified [Three.js](https://threejs.org) (`three` from npm) on a Soundor
canvas, as a benchmark: the same code in the JUCE runtime (WebGL 2 on ANGLE,
composited on the GPU without copies) and in the browser.

```text
soundor.config.ts   identity, a `gain` parameter, both runtimes
src/scenes.ts       the scenes: plain Three.js
src/main.tsx        the UI: scene picker, live statistics, "Run all"
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

Headless, in the JUCE runtime, without building the plugin (after building
the native tests, `cmake --workflow --preset dev` in
`runtimes/juce-runtime/native`):

```sh
pnpm build:web   # also bundles the UI into .soundor/ui/production
../../runtimes/juce-runtime/native/build/dev/tests/soundor_run_ui \
  .soundor/ui/production --size 700x480 --eval 'soundorBenchmark.run()'
```

It prints the results as JSON, then what the frames cost the compositor:
GPU read-backs (0 when WebGL is composited without copies), CPU layers
rasterized and bytes uploaded. `--software` allows a software GPU.
