---
title: 'End-to-end suite'
description: 'Soundor’s regression tests of its infrastructure: a plugin made to be tested, in the VST3 host on every platform and in Chromium.'
---

Source: [`tests/e2e/`](https://github.com/soundor/soundor/tree/main/tests/e2e).

`soundor-e2e` is a private package that guards the engine and the runtimes
against regressions a real plugin would see. Its plugin, **Soundor E2E**, is
built from the workspace like any project. It is not an example: it has one
of each thing the infrastructure does, each with an effect a test can see,
read or hear.

| Module (`src/`) | What it exercises                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `rendering/`    | One opaque color drawn by a view's style, a 2D canvas, WebGL 2 and an SVG image; text             |
| `controls/`     | Parameters as a slider, a radio group and a toggle; presets; state the session saves              |
| `native/`       | The Rust controller's sync and async methods and its event; the processor's streams               |
| `web-apis/`     | The JavaScript language and Web globals, checked inside the runtime; `fetch()`; `soundor:storage` |
| `scrolling/`    | A list clipped to its box, scrolled by the wheel                                                  |

`lib/` is its Rust: a processor whose output a test can predict exactly
(input × gain × level, inverted or bypassed) and a controller.
`web/inputs.ts` gives the web runtime a custom audio input.

## The suites

| Suite       | Runs in                                      | Command                                           |
| ----------- | -------------------------------------------- | ------------------------------------------------- |
| `e2e/vst3/` | The Debug VST3 in the VST3 host (vitest-e2e) | `xvfb-run -a pnpm --filter soundor-e2e test:vst3` |
| `e2e/web/`  | The web build in Chromium (Playwright)       | `pnpm --filter soundor-e2e test:web`              |

The VST3 suite has a file per subsystem: `rendering` (colors read back from
captures, with the CPU compositor and with the platform's), `layout`,
`input`, `accessibility`, `native`, `javascript`, `audio`, `session` (saved
state, presets, the editor closed and opened again, instances) and `parity`
(the same Rust as the VST3 and as WebAssembly, sample for sample). The web
suite covers drawing, the checks, controls through ARIA, the controller and
the processor's streams, the host's audio inputs, and no WebGL.

Like any workspace VST3 build, the VST3 suite needs the runtime's adapter and
a VST3 host first:

```sh
pnpm turbo run build --filter=soundor-e2e^...
pnpm --filter @soundor/vst3-runtime build:native debug
pnpm --filter @soundor/vst3-host build:native
xvfb-run -a pnpm --filter soundor-e2e test:vst3
```

Where there is no GPU, the WebGL swatch says so and its test passes without
it; `SOUNDOR_REQUIRE_GPU=1` makes it fail instead.

## In CI

The E2E group (`e2e.yml`) runs the VST3 suite on Linux, macOS and Windows,
with the engine and the host Verify selected, when `soundor-e2e` is affected:
a change to the engine, a runtime, the host, the React renderer or anything
else the plugin is built with. The web suite runs in the Workspace job, with
the other browser tests. A failure keeps the suite's reports
(`.soundor/test-results/`: a screenshot, the UI's tree and the host's log),
never the plugin.

## Adding to it

When infrastructure breaks in a way a plugin would see, add what reproduces
it: a node, a method or a parameter in the plugin if it needs one, and a test
in the suite of its subsystem. Assert what a user would notice (a color, a
value, a sound), not how the engine got there, and keep it deterministic on
every platform: text is drawn differently on each, so compare colors and
sizes, not screenshots of text.
