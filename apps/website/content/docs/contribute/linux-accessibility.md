---
title: 'Linux accessibility'
description: 'Native AT-SPI over system GDBus: protocol, ownership, lifecycle, and verification limits.'
---

Soundor maintains one platform-independent semantic tree. Its adapters expose
that information through the operating system's accessibility APIs:

| Platform | Implementation               |
| -------- | ---------------------------- |
| macOS    | Native NSAccessibility       |
| Linux    | Native C++ AT-SPI over GDBus |
| Windows  | Native UI Automation         |

Linux's implementation is in `engines/engine/src/a11y/linux/`. It implements
the [official AT-SPI D-Bus interfaces](https://gnome.pages.gitlab.gnome.org/at-spi2-core/devel-docs/xml-interfaces.html)
using system GIO. It does not implement a D-Bus transport or link libatspi's
client API.

## Semantic and protocol coverage

- Accessible names, hints/descriptions, roles, stable object identities,
  parent/child navigation, attributes and bulk cache queries.
- Disabled, checked/mixed, selected, expanded, busy and modal states.
- Numeric ranges and formatted values through Value; readable static and input
  text through basic Text queries, with Unicode character offsets. Editable
  text supports replacing the whole value through SetTextContents.
- Activation, increment/decrement, expand/collapse, focus/blur, long press,
  escape and custom actions when the semantic node offers them. Numeric writes
  use Value.CurrentValue; textual writes use EditableText.SetTextContents.
- Bounds in screen, window or parent coordinates; explicit keyboard-focus
  requests are separate from assistive technology's reading cursor.
- Incremental object/property/state/children/bounds/text notifications and cache
  additions/removals. Focus-only updates do not require changed nodes.
- Modals and portal/overlay ownership use SurfaceSemantics' existing filtering
  and relationships. The adapter does not construct another semantic model.

Some clients may not present every role or offered action. Protocol tests
validate what Soundor exposes; they do not certify screen-reader behavior.
There is no automated Orca or external accessibility-client test harness.

Soundor does not supply caret positions, selections, character rectangles,
text layout boundaries, rich text or arbitrary editable-text range operations.
The adapter does not fabricate these capabilities. Unknown or unsupported
methods return D-Bus errors. Text.CaretOffset is unavailable (`-1`).

Screen bounds come from the editor under X11/XWayland. Native Wayland does not
provide global window coordinates; when screen geometry is unknown the adapter
reports unavailable screen positions. It cannot scroll or resize nodes through
Component methods: layout owns their geometry. The semantic contract supplies
no numeric step, so Value.MinimumIncrement is zero.

## Connections and editor lifetime

Each editor owns a private accessibility-bus connection, a GMainContext and a
worker thread. It discovers the bus through org.a11y.Bus.GetAddress on a private
session-bus connection, or uses AT_SPI_BUS_ADDRESS when provided by the desktop.
No process-shared g_bus_get connection, host GLib loop, process-global GLib
configuration or environment modification is required.

Application roots register through Socket.Embed. A connection's unique bus name
and stable object paths identify its objects; separate editors and independently
compiled plugin binaries cannot collide. Application.Id and the desktop parent
reference follow the registration protocol. Registry restarts and bus closures
trigger re-registration/reconnection while retaining the semantic mirror.

The UI thread submits plain semantic updates. Bus callbacks only read the mirror
on the owned context. Actions enter a bounded queue and are dispatched through
RuntimeHost::performAccessibilityAction on the UI thread. Full resets invalidate
queued actions from older tree generations. The audio thread uses none of this.

Closing marks the adapter as closing, rejects actions, cancels pending work,
unregisters objects, closes its private connection and drains completions on its
context before joining the worker and releasing callback state. Another editor's
connection is unaffected. Missing services remain inactive and retry without
blocking the UI on normal bus calls. Closing a connection also unregisters the
application from the AT-SPI registry. GIO is never manually unloaded.

## Dependencies and migration

Linux builds need pkg-config and GIO development files (`libglib2.0-dev` on
Ubuntu/Debian). A plugin needs the system shared library `libgio-2.0.so.0`, with
its GLib/GObject dependencies. Source builds and prebuilt imports propagate
this through SoundorPlatformLibraries.cmake automatically. GIO is not statically
linked, vendored or copied into prebuilt archives. See the engine's NOTICE.md
for LGPL attribution and distribution requirements when bundling system libraries.
Soundor-owned code remains MIT licensed.

Linux accessibility uses only dynamically linked system GIO/GDBus. Independent
Rust audio processors remain supported; engine accessibility requires no Rust
static library or toolchain. Windows uses [native UI Automation](/docs/contribute/windows-accessibility).

## Verification

Native adapter/protocol tests run against private local D-Bus daemons with an
in-process registry fixture. They cover semantic mappings, serialization,
actions, focus-only and incremental updates, modal relationships, Unicode text,
independent editors, cancellation during authentication, unavailable services,
registry restarts and bus reconnection. Existing semantic tests remain in place; Windows has focused native UIA tests.

The JUCE runtime's `test:rust-link` builds a real Linux VST3 with an independent
Rust processor static library and a prebuilt C++ engine. It checks the actual
link inputs, dynamic GIO dependency and single Rust personality symbol, then
loads and renders audio through the existing headless VST3 host. It opens no
editor and introduces no accessibility E2E infrastructure. For a locally staged
engine, pass `--engine /path/to/extracted-stage`.

No Linux desktop environment or screen-reader combination has been manually
certified by these tests. X11/XWayland integration relies on the existing editor
geometry contract. Desktop-specific behavior and Orca presentation still need
manual verification before claiming support for a particular environment.
