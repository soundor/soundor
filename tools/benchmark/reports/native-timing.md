# Native timing animation measurements

Measured implementation commit `267bfd2254e41683e15395c20bf678e3688ac27d`; saved Hermes baseline source `629fca5f447ca4dad6a86c9cad9fe2a911e5c69d` (merged by PR #110). Hermes revision `602befee340da188ea1560cde7a9cc33e6b180dc`. Matching compiler SHA-256 `fa5b1d69d6a92950f3fbcd7c11831884cfb2c2ce0c78c178f0034ef21f193176`. Machine-readable reports include runner/bytecode hashes, raw runs, configuration and both alternating summaries.

Environment: Linux 7.0.0-38-generic, Intel Core 5 210H, four available cores; OpenGL ANGLE / Mesa 25.2.8 virgl NVIDIA GeForce RTX 4050 Laptop GPU. Release Hermes bytecode, 700×520 viewport, 30 warmup and 600 measured frames per run. Five alternating baseline/candidate runs for animations; three for unrelated rendering. Animation time advances deterministically by 1000/60 ms per frame, with identical one-second linear ramps, nodes, content and toolbar. Initialization/bundling is excluded. Results below are medians of run means or run percentiles, not pooled percentiles.

These are uncapped headless CPU frame and composition timings, not display FPS or GPU execution measurements. Hardware/backend must match for direct comparisons. Small differences and tails have substantial run variability; inspect the report spreads and maxima before drawing conclusions.

| Scenario              | JS mean frame ms | Native mean frame ms | Reduction | JS / native P95 ms | JS / native P99 ms |
| --------------------- | ---------------: | -------------------: | --------: | -----------------: | -----------------: |
| animation-opacity-1   |           0.2592 |               0.2131 |     17.8% |    0.2940 / 0.2733 |    0.4790 / 0.4315 |
| animation-opacity-50  |           0.5552 |               0.3348 |     39.7% |    0.7276 / 0.4419 |    0.9849 / 0.6019 |
| animation-opacity-500 |           3.0643 |               1.6027 |     47.7% |    3.4070 / 2.3842 |    8.4607 / 3.6852 |
| animation-react-50    |           1.2805 |               0.3286 |     74.3% |    1.5829 / 0.4330 |    1.8085 / 0.6243 |
| animation-react-500   |           9.1078 |               1.6229 |     82.2% |   10.7567 / 2.4465 |   15.6857 / 3.7308 |
| animation-plugin-50   |          12.0878 |               6.4685 |     46.5% |   13.0633 / 7.5572 |  19.0225 / 10.0497 |
| animation-mixed-20    |           4.4980 |               3.0530 |     32.1% |    4.9095 / 3.5187 |   10.4869 / 5.7228 |

## Transforms

PR 0 lacked transform support. These compare matched JS/native implementations at the same PR 1 commit, not an invented PR 0 baseline.

| Scenario                | JS mean frame ms | Native mean frame ms | Reduction | JS / native P95 ms | JS / native P99 ms |
| ----------------------- | ---------------: | -------------------: | --------: | -----------------: | -----------------: |
| animation-transform-1   |           0.3247 |               0.2097 |     35.4% |    0.3933 / 0.3093 |    0.6604 / 0.4669 |
| animation-transform-50  |           1.1247 |               0.3581 |     68.2% |    1.4491 / 0.4944 |    2.1459 / 0.6833 |
| animation-transform-500 |           9.6673 |               1.5936 |     83.5% |   10.2463 / 2.4713 |   11.3236 / 3.7150 |

## Work, memory and tradeoffs

- `animation-opacity-500`: UI calls/frame 500.000 → 8.333; rasterized layers/frame 1.000 → 0.000; uploads KiB/frame 800.000 → 0.000; CPU-side composition 0.3071 → 0.8462 ms.
- `animation-react-500`: UI calls/frame 500.000 → 8.333; rasterized layers/frame 1.000 → 0.000; uploads KiB/frame 800.000 → 0.000; CPU-side composition 0.4488 → 0.8681 ms.
- `animation-mixed-20`: UI calls/frame 84.000 → 64.333; rasterized layers/frame 1.000 → 20.000; uploads KiB/frame 474.366 → 502.734; CPU-side composition 0.3632 → 0.3889 ms.
- `animation-plugin-50`: UI calls/frame 210.000 → 160.833; rasterized layers/frame 1.000 → 50.000; uploads KiB/frame 849.389 → 1240.469; CPU-side composition 0.4505 → 0.8241 ms.

Native opacity ×500 update time is 0.04863 ms/frame, with 2441.93 KiB peak cached CPU source pixels. This excludes composition targets, physical GPU memory and process RSS. The older baseline did not expose this metric, so no memory delta is claimed.

Opacity, React opacity and transform native workloads perform zero intermediate style mutations, Yoga passes, rasterizations and uploads after warmup. PR 1 timing reversals still submit descriptions at completion boundaries; PR 2 can move repetition entirely native. React benchmarks mount the identical component tree and compare per-frame state updates with native low-level node animation; they do not measure repeated declarative target changes.

Mixed/plugin cases retain JS-driven knob/slider layout and numeric text updates, and static Canvas/WebGL scenes. Isolation increases layer counts and uploads in these workloads. Many opacity groups also increase CPU-side composition cost even when total frame time improves. These regressions are reported above.

Driver script timing measures its callback including synchronous native bindings, and excludes completion jobs; native tick and total frame timings include completion jobs. Engine heap is measured at startup and is not total application memory. Cache reservations are bounded at 64 MiB; viewport CPU fallback can repaint/read back WebGL. Cached bitmap transforms can differ at antialiased edges from freshly rasterized vectors.

## Unrelated rendering

| Scenario       | Baseline mean ms | Candidate mean ms | Change |
| -------------- | ---------------: | ----------------: | -----: |
| waveform-1k    |           1.8903 |            1.8931 |  +0.2% |
| waveform-5k    |           5.7233 |            5.6476 |  -1.3% |
| waveform-10k   |          12.0130 |           11.8984 |  -1.0% |
| canvas-complex |           2.2554 |            2.2149 |  -1.8% |
| react-100      |           1.3592 |            1.3614 |  +0.2% |
| react-500      |           5.2944 |            5.3851 |  +1.7% |
| react-1000     |          10.3627 |           10.6097 |  +2.4% |
| style-opacity  |           2.7096 |            2.7932 |  +3.1% |
| style-height   |           1.0617 |            1.1532 |  +8.6% |

Legacy `style-height` uses wall-clock input, so differing timing changes its mutation/upload work. Those counts are not a deterministic workload comparison. The animation scenarios use fixed input time. No fixed FPS threshold is imposed.

## Reproduce

Keep the saved `hermes-animation` build from PR 0, with its matching compiler/runtime, and run on the same machine/backend:

```sh
pnpm --filter soundor-benchmark bench --animations native --against hermes-animation --only animation --backend opengl --save native-timing
pnpm --filter soundor-benchmark bench --animations js --only animation-transform-1,animation-transform-50,animation-transform-500 --backend opengl --save transform-js
pnpm --filter soundor-benchmark bench --animations native --against transform-js --only animation-transform-1,animation-transform-50,animation-transform-500 --backend opengl
pnpm --filter soundor-benchmark bench --animations js --against hermes-animation --only ui,canvas --backend opengl --runs 3
```

Saved executables/bytecode are local reproducibility assets, not published plugin binaries. Preserve `native-timing` as the PR 2 timing baseline. Native automatic OS reduced-motion discovery and general Yoga layout animations remain deferred; the native host/UI preference is explicit, while Web observes its media query.
