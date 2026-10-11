# JavaScript engine comparison

Measured 2026-10-11T09:47:19.055Z on linux x64, Intel(R) Core(TM) 5 210H.

Three.js 0.186.1; Release builds with Clang 18.1.3 and lld.
QuickJS-NG v0.17.0 (`6d46d07d04041b40f4f49eaa7fdebe44c314c699`), using Soundor's engine build flags.
Hermes upstream main (`602befee340da188ea1560cde7a9cc33e6b180dc`), compiled with `-O -Xes6-class`.
The Hermes CLI reports HBC bytecode version 96. ES6 class support is experimental.

Bytecode mode; 5 alternating pairs per scenario, 30 warm-up updates and 120 measured updates per process. All output checksums matched.

| Scenario       | QuickJS ms/update (median; range) | Hermes ms/update (median; range) | QuickJS/Hermes |
| -------------- | --------------------------------- | -------------------------------- | -------------- |
| particles      | 37.742; 37.617–38.733             | 21.700; 21.358–21.942            | 1.74x          |
| instanced      | 64.758; 64.625–66.717             | 28.242; 28.158–30.317            | 2.29x          |
| meshes         | 0.975; 0.942–1.050                | 0.433; 0.433–0.575               | 2.25x          |
| scene-matrices | 4.817; 4.775–4.992                | 2.308; 2.275–2.333               | 2.09x          |

The ratios describe these CPU workloads on this machine and engine configuration.
Setup and checksum calculation are excluded from update timing. The ranges are
the minimum and maximum batch averages across five processes, not per-update
latency percentiles. Date.now has 1 ms resolution; each batch time is divided
by 120 updates. Rendering and the Soundor bridge are outside the experiment.

Repeated after the runtime moved to Hermes (same pins, same machine, a later
session): particles 37.083 / 20.933 (1.77x), instanced 63.417 / 27.492
(2.31x), meshes 0.892 / 0.433 (2.06x), scene-matrices 4.358 / 2.142 (2.04x);
no ranges overlapped and all checksums matched.

Reproduce from this example:

```sh
node scripts/bench-js.ts --no-build --out .soundor/js-engines/comparison-bytecode.json
```

Omit `--no-build` to build the engines first. The raw local report includes
individual samples and checksums; it is ignored by Git under `.soundor/`.
Bundle SHA-256: `e94f34b693528b78c6a2b291f6907268592bcb2297cc5b895f8fe422c0168a1f`.

Validation: all four scenarios also passed a source-mode smoke run with
10 measured updates and two warm-up updates; their checksums matched the
equivalent bytecode smoke run. TypeScript checking and oxlint passed.
