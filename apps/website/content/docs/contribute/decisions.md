---
title: 'Design decisions'
description: 'Why the major choices fit Soundor, the tradeoffs they carry, and the evidence behind them.'
---

These notes explain the technical reasons for Soundor's major choices and the
tradeoffs they carry. Linked PRs record historical decisions. Sections without
a historical source give an architectural rationale inferred from the current
design. Historical measurements describe the build and machine used then.

## Hermes instead of QuickJS-NG

Soundor first ran on QuickJS-NG and switched to the Hermes interpreter in
[PR #108](https://github.com/soundor/soundor/pull/108). That PR records faster
JavaScript workloads and a smaller engine heap in alternating comparisons,
with a larger stripped plugin binary. Its measurements include React updates,
Canvas drawing and JavaScript-heavy Three.js scenes. The
[footprint table](/docs/contribute/engine-reference#footprint) records the size
tradeoff.

Production builds compile bytecode using `hermesc` from the same pinned build
as the VM, and link the interpreter without its compiler. Development keeps
source loading and reload. A runtime change must account for language support,
module lowering, bytecode compatibility, resource lifetime and host safety as
well as execution time.

## No JIT

The native UI runs in an interpreter. The
[JUCE runtime guide](/docs/juce-runtime#performance-what-a-frame-costs) records
that plugin hosts do not all allow a JIT. Layout, painting and composition run
in native code; the UI's JavaScript runs on the message thread. Portable UI
performance therefore cannot depend on a JIT becoming available.

An interpreter keeps the execution model usable in those hosts, while build-time
bytecode compilation keeps parsing and compilation out of production UI startup.
The cost is lower JavaScript throughput than a design that could assume a JIT.
Soundor handles layout, drawing, compositing and native animation timelines in
C++, and performance work measures the JavaScript that remains on each frame.

## Skia on the CPU, ANGLE for the GPU

Skia rasterizes UI content and Canvas 2D into CPU layers. ANGLE provides WebGL
and the GPU composition path where supported. Soundor's compositor combines
those layers, with a CPU fallback. A compatible GPU compositor shares WebGL
textures without readback. See [Rendering](/docs/contribute/engine-reference#rendering).

This division keeps ordinary UI painting available without a GPU and lets
platform presentation evolve separately from drawing. Cached CPU layers can be
reused until their content changes; GPU composition can move or fade those
layers without repainting them. ANGLE supplies the graphics API adaptation for
WebGL and composition on supported platforms.

The tradeoff is maintaining CPU and GPU presentation paths and their resource
handoff. CPU composition of a GPU canvas can require readback, so sharing the
device and avoiding readback on the GPU path are explicit tested invariants.

## Yoga for layout

Soundor needs a layout algorithm for a custom native node tree, independent of
JUCE widgets and browser layout. [Yoga](https://www.yogalayout.dev/) supplies a
portable engine targeting web layout standards. Its flex layout model fits
Soundor's React component and style API, and native code can calculate layout
without implementing that algorithm in JavaScript.

The web runtime reproduces Yoga's layout defaults on DOM elements so shared
React code has consistent behavior. See
[UI implementation](/docs/contribute/engine-reference#soundorui) and the
[web implementation](/docs/web-runtime#vite-and-the-plugin-ui).

The tradeoff is a deliberate layout subset and defaults to maintain across both
implementations. A browser's CSS defaults are not automatically Soundor's
defaults; a new style property needs declarations, native mapping, browser
mapping and corresponding tests.

## Soundor owns accessibility semantics

The UI exposes accessibility properties on Soundor nodes. Soundor derives a
semantic tree, then native platform backends and web ARIA consume it. This
keeps roles, values, modal visibility and logical ownership consistent across
runtime implementations. JUCE supplies a view and attachment point rather
than defining Soundor's control semantics.

The native UI is a custom-drawn node tree, so its controls are not individual
JUCE widgets whose semantics can simply be reused. Soundor also knows about
logical ownership through portals and modal visibility. Deriving semantics
where that information lives gives every platform the same meaning for a
control, including the browser implementation.

The cost is owning the semantic rules and testing their platform mappings.
Those rules live in engine `src/a11y/` and web client `ui/semantics.ts`, with
tests in both implementations.

## AccessKit on Windows/Linux, own bridges on Apple

[PR #84](https://github.com/soundor/soundor/pull/84) adds the AccessKit backend
for Windows and Linux. AccessKit's
[tree-and-action model](https://accesskit.dev/how-it-works/) fits Soundor's
semantic tree: Soundor sends updates, and assistive technology requests actions
through the adapter. Its Windows and Unix adapters supply UI Automation and
AT-SPI integration, so Soundor can reuse those platform implementations.
AccessKit types stay private to the backend. The pinned C release supplies
static libraries, avoiding a Rust toolchain requirement for plugin authors.

Several plugins and engine versions may share a host process. Objective-C class
names are process-global, so hiding C++ symbols cannot prevent their collisions.
The [Apple bridge](/docs/contribute/apple-accessibility#plugin-safety) creates
an element subclass with a unique runtime name, avoids fixed class names,
categories and swizzling, and keeps late platform callbacks safe after view
teardown. Tests load multiple plugin binaries in one process.

Soundor's own bridge on Apple gives it control over that class registration,
attachment and callback lifetime. That control matters when a host loads
several copies or versions and retains accessibility objects after an editor
closes. The tradeoff is maintaining the macOS and iOS mappings and manual
assistive-technology checks as well as the automated lifetime tests.

## No DSP abstraction

Soundor shares the UI and its contract. Native plugin authors implement DSP in
their host project; web projects implement their audio with Web Audio. The
native API is a typed bridge to that code, rather than a portable DSP language.
See [Web runtime limitations](/docs/web-runtime#limitations).

Keeping audio in the host project lets authors use its existing processing
model: a JUCE audio callback in C++, or browser audio nodes and routing. Sharing
the UI does not require adopting a Soundor signal-processing language or
translating an existing processor into one. Parameters and the typed native API
provide the boundary the UI needs.

A shared DSP layer would also need to define processing, real-time state and
compatibility across those backends. Keeping that responsibility with the
plugin author keeps Soundor focused on the UI and its integration. The tradeoff
is explicit: shared UI and API declarations do not make the audio implementation
portable. A project targeting both runtimes supplies both audio implementations.
