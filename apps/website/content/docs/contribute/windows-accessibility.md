---
title: 'Windows accessibility'
description: 'Native UI Automation: HWND ownership, COM lifetime, threading, and verification limits.'
---

Windows exposes Soundor's existing semantic tree through native Microsoft UI
Automation (UIA). The implementation is in `engine/src/a11y/windows/`.
It links Windows system libraries and requires no Rust accessibility archive.
The public React props and `soundor:ui` accessibility API are unchanged.

## HWND ownership

The generated editor passes its own peer HWND to `createPlatformAccessibility`.
The adapter attaches on that window's UI thread using `SetWindowSubclass`.
It handles only `WM_GETOBJECT` with `UiaRootObjectId`, returning the editor's
fragment through `UiaReturnRawElementProvider`. Other messages and object IDs
continue through `DefSubclassProc`. No window class or parent HWND is modified.
Detachment and `WM_NCDESTROY` remove only that adapter's subclass.

An embedding framework must pass the HWND that owns its plugin view, never a
DAW's parent window. `UiaHostProviderFromHwnd` supplies the fragment's native
host provider; Soundor does not replace the DAW's provider.

## Providers and semantics

The HWND has one persistent root supporting `IRawElementProviderSimple`,
`IRawElementProviderFragment` and `IRawElementProviderFragmentRoot`. Each exposed
semantic node has one stable COM identity while it exists. Navigation follows
the shared semantic tree, including its existing modal and portal filtering.
Names, descriptions, input placeholders, enabled and busy states, keyboard focus and physical
screen bounds come from that same tree and the editor's geometry.

Patterns reflect semantic capabilities: Invoke, Value, RangeValue, Toggle,
Selection, SelectionItem, ExpandCollapse and Window for dialogs. Text fields replace their whole
value; numeric writes are finite and bounded by the semantic range. Selection
containers are single-selection radio groups and tab lists. The semantic model
has no numeric step; UIA reports an unknown step (`NaN`). Soundor does not
fabricate text ranges, caret positions or rich text patterns. UIA has no
standard pattern for arbitrary named actions; these remain in the shared
semantic contract for platforms that expose them.

The HWND supplies the root's runtime ID. Descendants use `UiaAppendRuntimeId`,
an editor GUID and the full semantic node ID. Independent engine modules can
use overlapping counters without colliding. Reload keeps the HWND root identity
and invalidates providers for nodes that have gone.

After activation, changed semantic properties and child structures produce
UIA notifications; focus-only updates are preserved. Values without a set-value
action remain queryable without sending an event on every DSP/analyzer frame.

## Threads, shutdown and plugin coexistence

Each editor owns its tree mirror, provider cache, mutex and bounded action
queue. Provider queries read only plain semantic data under that mutex. They
never call JavaScript or wait for the editor thread. Actions are validated and
queued; `tick()` drains them through `RuntimeHost::performAccessibilityAction`
on the UI thread. Requests from before a runtime replacement are discarded.
Screen coordinates are captured on the HWND thread. UIA calls that can re-enter
providers, including events and disconnection, happen without the tree lock.

Soundor does not initialize or uninitialize COM, register COM classes, or keep a
process-wide provider registry. Closing first invalidates the editor state and
removes its subclass, then calls `UiaDisconnectProvider` for its own cached
providers. It never calls the process-wide disconnect function. Removed nodes
are similarly disconnected individually. Retained COM references return
`UIA_E_ELEMENTNOTAVAILABLE`; their state contains no reference to a runtime,
semantic node pointer, HWND owner or editor object.

As with the Apple backend, the existing module-pinning safeguard keeps the
plugin binary mapped once it exposes a provider: clients may retain its COM
vtables indefinitely. Releasing the host's library reference is safe, but actual
unmapping after UIA activation is deliberately unsupported. Editor trees,
actions, subclass registrations and provider ownership are still released.
No other plugin's binary, provider, COM apartment or window is disconnected.
Engine symbols remain in the versioned ABI namespace and are not exported.

## Verification

The existing native doctest suite covers direct provider interfaces, semantic
mapping, navigation, geometry, focus, selection and toggle actions, disabled
states, runtime IDs, retained references, concurrent queries during teardown,
and repeated HWND open/close with both destruction orders. The existing
coexistence host checks multiple instances and two independently linked plugin
modules, including retained providers after releasing a plugin's library
reference. These tests run with the engine's Windows source/prebuilt checks;
no commercial DAW or external accessibility E2E framework is required.

The two module fixtures use the current engine version. Different-version
artifacts and manual Narrator/DAW combinations are separate verification; these
tests do not certify them. Linux AT-SPI and Apple's native bridges are unchanged.
