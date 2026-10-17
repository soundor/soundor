---
title: 'Design decisions'
description: 'Recorded choices, their evidence, and design questions that still need an answer.'
---

These notes separate reasons recorded in the repository from questions that
still need the project's authors to answer. Historical measurements describe
the build and machine used then; they are not current performance guarantees.

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

Open question: record any additional deployment or predictability reasons
behind this constraint, beyond host compatibility.

## Skia on the CPU, ANGLE for the GPU

Skia rasterizes UI content and Canvas 2D into CPU layers. ANGLE provides WebGL
and the GPU composition path where supported. Soundor's compositor combines
those layers, with a CPU fallback. A compatible GPU compositor shares WebGL
textures without readback. See [Rendering](/docs/contribute/engine-reference#rendering).

This is the current division of work. Open question: record the original
reasons for starting with CPU Skia and adding ANGLE rather than choosing a
different rendering stack. Do not infer that history from today's code.

## Yoga for layout

Native nodes use Yoga. The web runtime reproduces its layout defaults on DOM
elements so shared React code has consistent behavior. See
[UI implementation](/docs/contribute/engine-reference#soundorui) and the
[web implementation](/docs/web-runtime#vite-and-the-plugin-ui).

Open question: record the selection criteria and alternatives considered when
Yoga was chosen.

## Soundor owns accessibility semantics

The UI exposes accessibility properties on Soundor nodes. Soundor derives a
semantic tree, then native platform backends and web ARIA consume it. This
keeps roles, values, modal visibility and logical ownership consistent across
runtime implementations. JUCE supplies a view and attachment point rather
than defining Soundor's control semantics.

The semantic rules live in engine `src/a11y/` and web client `ui/semantics.ts`,
with tests in both implementations. Open question: record any original reasons
for this ownership beyond the cross-runtime behavior the implementation now
enforces.

## AccessKit on Windows/Linux, own bridges on Apple

[PR #84](https://github.com/soundor/soundor/pull/84) adds the AccessKit backend
for Windows and Linux. Soundor keeps AccessKit types private to that backend.
Apple platforms use Soundor's own bridges.

Several plugins and engine versions may share a host process. Objective-C class
names are process-global, so hiding C++ symbols cannot prevent their collisions.
The [Apple bridge](/docs/contribute/apple-accessibility#plugin-safety) creates
an element subclass with a unique runtime name, avoids fixed class names,
categories and swizzling, and keeps late platform callbacks safe after view
teardown. Tests load multiple plugin binaries in one process.

Open question: record the complete selection rationale for AccessKit and for
implementing the Apple bridges directly, including alternatives considered.

## No DSP abstraction

Soundor shares the UI and its contract. Native plugin authors implement DSP in
their host project; web projects implement their audio with Web Audio. The
native API is a typed bridge to that code, rather than a portable DSP language.
See [Web runtime limitations](/docs/web-runtime#limitations).

Open question: record why a portable DSP abstraction is outside the project's
scope and which boundaries future audio integrations should preserve.
