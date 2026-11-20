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

The native UI runs in an interpreter: plugin hosts do not all allow a JIT
(see [what a frame costs](/docs/vst3-runtime#performance-what-a-frame-costs)).
Layout, painting and composition run in native code; the UI's JavaScript runs
on the host's UI thread. Portable UI
performance therefore cannot depend on a JIT becoming available.

An interpreter keeps the execution model usable in those hosts, while build-time
bytecode compilation keeps parsing and compilation out of production UI startup.
The cost is lower JavaScript throughput than a design that could assume a JIT.
Soundor handles layout, drawing, compositing and native animation timelines in
C++, and performance work measures the JavaScript that remains on each frame.

## Skia drawing, ANGLE for GPU rendering

Skia draws UI content and Canvas 2D into GPU surfaces through Ganesh on macOS, Windows and Linux
when available, with CPU layers as fallback and on other platforms. ANGLE
provides WebGL and the GPU composition path where supported. Soundor's compositor combines
those layers, with a CPU fallback. A compatible GPU compositor shares WebGL
textures without readback. See [Rendering](/docs/contribute/engine-reference#rendering).

This division keeps ordinary UI painting available without a GPU and lets
platform presentation evolve separately from drawing. Cached UI layers can be
reused until their content changes; GPU composition can move or fade those
layers without repainting them. ANGLE supplies the graphics API adaptation for
WebGL and composition on supported platforms.

The tradeoff is maintaining CPU and GPU presentation paths and their resource
handoff. CPU composition of a GPU canvas can require readback, so sharing the
device and avoiding readback on the GPU path are explicit tested invariants.

## Yoga for layout

Soundor needs a layout algorithm for a custom native node tree, independent of
any plugin framework's widgets and of browser layout. [Yoga](https://www.yogalayout.dev/) supplies a
portable engine targeting web layout standards. Its flex layout model fits
Soundor's React component and style API, and native code can calculate layout
without implementing that algorithm in JavaScript.

The web runtime lays out with the same engine: its C++ core, Yoga included,
compiled to WebAssembly, which places DOM elements where it says. It once
reproduced Yoga in CSS, which it could not wherever the result depends on the
parent: a box's content overflowing it instead of being squeezed, for one; then
it called a separately compiled Yoga from TypeScript, with its own copy of the
style mapping and text layout. See [The engine in the browser](/docs/contribute/web-engine), the
[UI implementation](/docs/contribute/engine-reference#soundorui) and the
[web implementation](/docs/web-runtime#development-and-builds).

The tradeoff is a WebAssembly module in every page, about 150 KB gzipped (the
engine's core, not only Yoga), and a new style property needs declarations, the
shared style reader, the DOM adapter's CSS and corresponding tests. Measuring
text with the browser's fonts, and wrapping it by the engine's rules, is what
keeps the DOM drawing what Yoga sized.

## Soundor owns accessibility semantics

The UI exposes accessibility properties on Soundor nodes. Soundor derives a
semantic tree, then native platform backends and web ARIA consume it. This
keeps roles, values, modal visibility and logical ownership consistent across
runtime implementations. The plugin's editor supplies a view and attachment
point rather than defining Soundor's control semantics.

The native UI is a custom-drawn node tree, so its controls are not individual
framework widgets whose semantics can simply be reused. Soundor also knows about
logical ownership through portals and modal visibility. Deriving semantics
where that information lives gives every platform the same meaning for a
control, including the browser implementation.

The cost is owning the semantic rules and testing their platform mappings.
Those rules live in engine `src/a11y/` and web client `ui/semantics.ts`, with
tests in both implementations.

## Native platform accessibility

Soundor owns the semantic tree and actions. Native backends translate that tree
into Windows UI Automation, Linux AT-SPI over GDBus, and Apple's accessibility
APIs. Each editor owns its attachment and lifetime; platform callbacks read
semantic snapshots and actions return to the UI thread. See the
[Windows](/docs/contribute/windows-accessibility),
[Linux](/docs/contribute/linux-accessibility) and
[Apple](/docs/contribute/apple-accessibility) implementation notes.

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

## Audio in Rust, not a DSP abstraction

Soundor shares the UI, its contract and one Rust crate, `lib/`: its processor
runs natively in the VST3 plugin and as WebAssembly in an AudioWorklet, and its
controller implements the typed native API in both. Soundor defines no
signal-processing language and no DSP library: the crate is ordinary Rust, with
whatever crates the author chooses, behind a small, versioned C ABI
(`soundor::export!`). See [Rust audio processing](/docs/rust-processor).

The tradeoff is that plugin DSP is Rust: C++ DSP has no place to go, and the
browser's own audio nodes are not the processing model.

## A VST3 adapter instead of JUCE

Soundor once had a JUCE runtime: a JUCE project generated per plugin, compiled
with CMake, around the engine. It is gone. The VST3 runtime builds the same
plugins from a generic adapter on Steinberg's SDK, compiled once and shipped
prebuilt, so building a plugin compiles no C++, needs no CMake, and does not
bring JUCE's licence into every project. The engine already owned what JUCE had
supplied (input, accessibility, rendering, HTTP, the clipboard, the editor
through `editor::Editor`), so the adapter only speaks VST3.

The tradeoff is the formats: VST3 only, without AU, CLAP or a standalone
application, and only on Linux x86_64, macOS and Windows x64. Another format
would be another adapter on the same engine.
