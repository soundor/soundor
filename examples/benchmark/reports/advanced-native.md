# Advanced native animation measurements

Measured source: `8fb5742851ccb291d08f68d1c9616730ec283d74` (clean).

All comparisons reran matching saved binaries alternately on the same cell: Intel Core 5 210H, four visible cores, Linux 7.0.0-38-generic, virgl NVIDIA RTX 4050 Laptop GPU through ANGLE/OpenGL ES 3.2, Mesa 25.2.8; hardware rendering. Release, production Hermes bytecode, 700×520 viewport, 30 warmup ticks, 600 measured ticks per scenario, five repeated runs. Tables show medians across runs. Hermes revision `602befee340da188ea1560cde7a9cc33e6b180dc`, compiler SHA-256 `fa5b1d69d6a92950f3fbcd7c11831884cfb2c2ce0c78c178f0034ef21f193176`.

Saved JS and native advanced builds use the same source, runner and UI bytecode; playback mode is the only workload switch. `hermes-animation` is the preserved PR 0 build at `629fca5f447ca4dad6a86c9cad9fe2a911e5c69d`; `native-timing` is the preserved PR 1 build at `267bfd2254e41683e15395c20bf678e3688ac27d`. No QuickJS measurements are used.

## Same-content Hermes baseline comparisons

| Scenario              | PR 0 Hermes JS frame ms | Native frame ms | Reduction |   JS P95 / P99 ms | Native P95 / P99 ms |
| --------------------- | ----------------------: | --------------: | --------: | ----------------: | ------------------: |
| animation-opacity-50  |                  0.5470 |          0.3125 |     42.9% |   0.6939 / 0.9831 |     0.4278 / 0.6806 |
| animation-opacity-500 |                  3.0422 |          1.5105 |     50.3% |   3.4434 / 8.9750 |     2.1114 / 3.1960 |
| animation-react-500   |                  9.0535 |          1.5318 |     83.1% | 10.6094 / 15.8758 |     2.2644 / 3.7306 |
| animation-mixed-20    |                  4.4840 |          2.9285 |     34.7% |  4.9512 / 10.7514 |     3.3634 / 5.7294 |

## Advanced workloads: current Hermes JS vs native

| Scenario               | JS frame ms | Native frame ms | Reduction | JS all-tick CPU ms | Native all-tick CPU ms | Native P95 / P99 frame ms |
| ---------------------- | ----------: | --------------: | --------: | -----------------: | ---------------------: | ------------------------: |
| advanced:spring:50     |      0.7814 |          0.3868 |     50.5% |             0.2351 |                 0.0136 |           1.0453 / 1.9818 |
| advanced:spring:500    |      4.7000 |          1.6254 |     65.4% |             2.2182 |                 0.0813 |           2.7861 / 4.4021 |
| advanced:retarget:50   |      0.6874 |          0.4167 |     39.4% |             0.2338 |                 0.0479 |           0.8598 / 2.6833 |
| advanced:retarget:500  |      4.0189 |          2.0653 |     48.6% |             2.2089 |                 0.4179 |          7.0550 / 12.1764 |
| advanced:parallel:50   |      1.3179 |          0.3264 |     75.2% |             0.5784 |                 0.0207 |           0.4084 / 0.6739 |
| advanced:parallel:500  |     11.2954 |          1.6364 |     85.5% |             5.5317 |                 0.1497 |           2.3992 / 3.7788 |
| advanced:repeat:50     |      0.5528 |          0.3183 |     42.4% |             0.2268 |                 0.0152 |           0.3954 / 0.6934 |
| advanced:repeat:500    |      3.1551 |          1.5064 |     52.3% |             2.1459 |                 0.0797 |           2.2103 / 3.3596 |
| advanced:keyframes:50  |      0.6091 |          0.3446 |     43.4% |             0.2334 |                 0.0166 |           0.5037 / 0.7654 |
| advanced:keyframes:500 |      3.2005 |          1.5608 |     51.2% |             2.1597 |                 0.0932 |           2.3329 / 3.2828 |
| advanced:paint:50      |      0.6359 |          0.3224 |     49.3% |             0.2641 |                 0.0163 |           0.4294 / 0.6833 |
| advanced:paint:500     |      3.5115 |          0.9152 |     73.9% |             2.4475 |                 0.0824 |           1.5161 / 1.9590 |
| advanced:sequence:1    |      0.2817 |          0.2253 |     20.0% |             0.0254 |                 0.0110 |           0.2870 / 0.4734 |
| advanced:sequence:50   |      0.5821 |          0.3436 |     41.0% |             0.2324 |                 0.0451 |           0.4727 / 0.6960 |

Frame distributions include rendered frames. `allTickMs` includes every measured host tick, including clamped spring plateaus. Headless throughput is uncapped; these figures do not measure display refresh or GPU execution. The JS references deliberately execute the same analytic spring, retargeting, four-keyframe curve, color channels and 20 ms sequence curve, on identical nodes. The sequence JS reference computes that curve directly; it does not allocate or dispatch a JS object graph with 1000 phases. This comparison measures the same visual workload, not equal sequence-construction overhead.

## Native execution and owned storage

| Scenario               | Kernel ms / rendered frame | Owned storage at warmup KiB | CPU raster cache KiB | UI calls / rendered frame | Repainted layers / rendered frame | Upload KiB / rendered frame |
| ---------------------- | -------------------------: | --------------------------: | -------------------: | ------------------------: | --------------------------------: | --------------------------: |
| advanced:spring:50     |                     0.0084 |                     43.6562 |            1535.5312 |                    0.0000 |                            0.0000 |                      0.0000 |
| advanced:spring:500    |                     0.1010 |                    434.6328 |            2386.3125 |                    0.0000 |                            0.0000 |                      0.0000 |
| advanced:retarget:50   |                     0.0073 |                     51.4062 |            1535.5312 |                    2.7412 |                            0.0000 |                      0.0000 |
| advanced:retarget:500  |                     0.1056 |                    439.8828 |            2386.3125 |                   27.4123 |                            0.0000 |                      0.0000 |
| advanced:parallel:50   |                     0.0099 |                    133.3789 |            1535.5312 |                    0.0000 |                            0.0000 |                      0.0000 |
| advanced:parallel:500  |                     0.1232 |                   1203.2930 |            2386.3125 |                    0.0000 |                            0.0000 |                      0.0000 |
| advanced:repeat:50     |                     0.0043 |                     51.4062 |            1535.5312 |                    0.0000 |                            0.0000 |                      0.0000 |
| advanced:repeat:500    |                     0.0569 |                    439.8828 |            2386.3125 |                    0.0000 |                            0.0000 |                      0.0000 |
| advanced:keyframes:50  |                     0.0053 |                     77.9688 |            1535.5312 |                    0.0000 |                            0.0000 |                      0.0000 |
| advanced:keyframes:500 |                     0.0677 |                    705.5078 |            2386.3125 |                    0.0000 |                            0.0000 |                      0.0000 |
| advanced:paint:50      |                     0.0052 |                     51.4062 |               0.0000 |                    0.0000 |                            1.0000 |                    100.0000 |
| advanced:paint:500     |                     0.0583 |                    439.8828 |               0.0000 |                    0.0000 |                            1.0000 |                    800.0000 |
| advanced:sequence:1    |                     0.0012 |                   1065.6055 |            1442.8906 |                    0.0000 |                            0.0000 |                      0.0000 |
| advanced:sequence:50   |                     0.0337 |                  52876.4062 |            1535.5312 |                    0.0000 |                            0.0000 |                      0.0000 |

Kernel deltas and work counts retain the existing per-rendered-frame aggregation, including preceding idle ticks. They should not be mistaken for per-tick spring costs; use the all-tick timing distribution for that comparison. Warmup storage is an owned-capacity estimate, excluding allocator/hash-map overhead, JS descriptions, process RSS and GPU VRAM. The 1000-phase ×50 program uses about 51.6 MiB of estimated owned storage, versus about 0.43 MiB for 500 repeated timing effects. Raster cache figures count CPU source pixels only. No general native allocation profiler was available; deterministic tests verify that compiled program/vector capacity stays unchanged across phase transitions.

All non-retargeting advanced animations have zero intermediate UI bridge calls and base-style mutations. Opacity/transform/spring/keyframe/sequence workloads have zero Yoga passes, rerasterizations and GPU uploads after warmup. Paint has zero Yoga passes but repaints/uploads damaged content; it is not compositor-only. Retargeting submits on 400 ms target changes. The measurement driver still executes its fixed-step JS bookkeeping callback; no JS callback computes a native animation sample or advances an internal phase.

## Regressions and changes relative to PR 1

| Scenario                | PR 1 native frame ms | PR 2 native frame ms | Change | PR 1 kernel ms | PR 2 kernel ms |
| ----------------------- | -------------------: | -------------------: | -----: | -------------: | -------------: |
| animation-opacity-50    |               0.3286 |               0.2981 |  -9.3% |        0.00253 |        0.00402 |
| animation-opacity-500   |               1.6004 |               1.5254 |  -4.7% |        0.04850 |        0.05568 |
| animation-react-500     |               1.5643 |               1.5250 |  -2.5% |        0.04688 |        0.05284 |
| animation-mixed-20      |               2.9690 |               3.0345 |  +2.2% |        0.00398 |        0.00753 |
| animation-transform-500 |               1.5724 |               1.4969 |  -4.8% |        0.05430 |        0.06337 |

Native repetition removes the old timing endpoint submissions: opacity/React/transform ×500 went from 8.333 UI calls per frame to zero. Total frame time improved by about 2.5–4.8% in these 500-node cases. The extended kernel costs more: opacity ×500 update CPU rose 14.8%, transform ×500 rose 16.7%; opacity ×50 rose from 0.00253 to 0.00402 ms (58.7%, about 1.5 μs). Mixed frame time rose 2.2%, below the comparison threshold/noise. These costs are reported rather than hidden.

Relative to the PR 0 JS mixed workload, cached subtree isolation still rasterizes 20 smaller layers instead of one, and uploads 502.734 KiB/frame versus 474.366 KiB/frame (+6.0%). It nevertheless lowers total frame time in the matched run. Pure compositor workloads do not upload after warmup; paint workloads do. Startup heap changes include the added code/scenario descriptions and do not isolate per-animation memory.

## Validation and limits

`pnpm check`, GPU-required native CTest (8/8), CPU-only CTest (8/8), JUCE CTest (10/10), benchmark driver tests, and real Chromium spring/composition/seek/paint/repeat/reduced-motion checks passed. The local sanitizer preset could not link because the installed Clang 18 ASan archives are missing; the required sanitizer CI job must pass before merge.

Native execution uses the existing UI-thread tick, not a separate compositor thread: blocking the UI thread can still delay presentation. General Yoga layout animation, automatic native OS reduced-motion discovery, GPU timing/VRAM/RSS measurements and a general allocation profiler remain outside this implementation. Browser springs/composition are sampled once into native Web Animation curves; sampling, CSS color interpolation and common-period limits are documented in the runtime contract.

Machine-readable reports in this directory retain build hashes, matching runtime revisions, options, distributions, counts, repeat spreads and alternating baseline summaries. Saved binaries remain local under `.soundor/bench/builds/`.

## Existing UI/Canvas workloads

| Scenario       | PR 1 frame ms | PR 2 frame ms | Change | Combined repeat spread |
| -------------- | ------------: | ------------: | -----: | ---------------------: |
| waveform-1k    |        1.9943 |        2.0634 |  +3.5% |                  ±4.3% |
| waveform-5k    |        5.8750 |        5.9445 |  +1.2% |                  ±2.1% |
| waveform-10k   |       12.4398 |       12.4270 |  -0.1% |                  ±1.4% |
| canvas-complex |        2.4135 |        2.3848 |  -1.2% |                  ±5.4% |
| react-100      |        1.4812 |        1.4800 |  -0.1% |                  ±5.3% |
| react-500      |        5.6906 |        5.7304 |  +0.7% |                  ±2.2% |
| react-1000     |       11.1920 |       11.1596 |  -0.3% |                  ±1.3% |
| style-opacity  |        3.0424 |        3.0029 |  -1.3% |                  ±7.1% |
| style-height   |        1.2801 |        1.2943 |  +1.1% |                 ±13.0% |
| static         |        0.0000 |        0.0000 |  +0.0% |                  ±0.0% |

The Canvas/React frame changes ranged from −1.2% to +3.5%; none exceeded both the comparison threshold and combined repeat spread. `style-height` rose 1.1% with 13.0% combined spread and slightly different wall-clock-driven mutation/layout counts. Existing rendering scenarios retain their original time inputs; these are not fixed-step animation comparisons. Startup rose from about 10.2 to 10.7 ms (+5.3%, flagged by the harness); initialization is reported separately from steady-state frames.

## Transform reference introduced in PR 1

PR 0 had no transform API. The preserved PR 1 `transform-js` build provides the matching Hermes JS workload; it was rerun alternately with the candidate. Transform ×500: 9.5160 → 1.4350 ms/frame (84.9% lower); P95 10.0427 → 2.0321, P99 11.3363 → 2.8928. No unsupported PR 0 transform baseline is claimed.

Later source changes affect browser zero-duration seeking and documentation; the measured native runner and benchmark workloads are unchanged.
