---
title: 'Apple accessibility'
description: 'macOS bridge attachment, plugin safety, lifetimes, coordinates, and manual checks.'
---

Source: [`engine/src/a11y/apple/`](https://github.com/soundor/soundor/tree/main/engine/src/a11y/apple).

On macOS, VoiceOver perceives a Soundor view through virtual
`NSAccessibilityElement`s that Soundor creates from its own semantic tree
(`a11y::SurfaceSemantics`). There is one element per semantic element, not one
`NSView` per node. The Skia surface stays a single custom-drawn view. The plugin's editor only attaches
Soundor's native accessibility container; it does not define the semantics.

```text
Soundor semantic tree ──► MacPlatform (MacPlatform.mm) ──► NSAccessibilityElements ──► VoiceOver
                                   ▲
         plugin framework: the NSView, its accessibility parent, the geometry
```

## Attachment

A framework hands over only `a11y::NativeView`:

- `handle`: the `NSView` the surface is drawn in, for coordinate conversion;
- `accessibilityParent`: the object the elements are children of.

`PlatformAccessibility::accessibilityContainer()` is a plain, system-class
`NSAccessibilityElement` that is not an element itself. It holds the
top-level elements, and the framework lists it as the view's accessibility
child:

- **A framework with its own view:** set the view's accessibility
  children to the container's children, or return them from its
  `accessibilityChildren`, and pass the view as `handle`.

## Plugin safety

A host process may load several Soundor plugins, several versions of
Soundor, several builds of one plugin, plugins using other accessibility implementations, and unload any of them. The Objective-C class namespace is
process-global; C++ symbol hiding does nothing for it.

`AppleShared.mm` implements class registration, element tags, the token
registry and request queue shared with iOS. It and `MacPlatform.mm` are
compiled into the prebuilt `soundor_runtime` archive. Linking that archive
into independent plugin binaries gives each binary its own hidden C++ state,
including its lazy class registration. No plugin-specific Objective-C++ shim,
generated native source or plugin identity definition is needed. The engine's
existing hidden visibility and ABI namespace isolation remain in force.

Soundor changes no existing classes: no swizzling, categories, or modifications
to `NSView`, `NSWindow` or framework classes. The container is a system-class
`NSAccessibilityElement`; custom actions use `NSAccessibilityCustomAction` blocks.

### Objective-C runtime lifecycle and macOS limitations

**Why dynamic classes are necessary.** Accessibility actions such as press,
increment, decrement, cancel and setting a value require custom Objective-C
methods. The native macOS input adapter likewise needs custom AppKit
responder methods and shares the same class registration utility, naming
and lifetime principles.

**Why names are randomized.** Objective-C class registration is process-wide.
Independent plugins in one DAW may use the same or different engine versions.
The engine uses the system's `arc4random_buf` to generate 128 random bits for
`SoundorAXElement_<engine ABI>_<32 hex digits>`, checks the runtime registry,
and checks that `objc_allocateClassPair` succeeds. Uniqueness depends on the
random bits, not the diagnostic ABI prefix or a plugin ID. A function-local
static serializes lazy registration, once per binary, across editor instances.

**Why classes are not disposed.** Registered classes remain registered for
the lifetime of the host process. Soundor never calls `objc_disposeClassPair`.
[Apple requires that no instances of the class or its subclasses exist](<https://developer.apple.com/documentation/objectivec/objc_disposeclasspair(_:)>).
AppKit, accessibility infrastructure and runtime-generated subclasses make
those lifetime guarantees difficult to establish. Attempting disposal during
plugin shutdown can introduce crashes.

**Why we do not pin plugin binaries.** Soundor respects the normal DAW/plugin
lifecycle and does not retain the image with `RTLD_NODELETE` or another pinning
mechanism. This avoids permanent module retention imposed by Soundor itself;
it does not guarantee that macOS will unload the image.

**Known risks and tradeoffs.** Dynamic classes remain in the process-wide
registry. If macOS physically unloads a plugin binary, class metadata may retain
method implementations pointing into unmapped executable code. Retained custom
action blocks also contain code from that image. This is a residual safety risk,
even after thorough cleanup. Random names prevent practical naming collisions;
they do not prevent runtime enumeration or dangling pointers. Cleanup minimizes
callbacks reaching destroyed plugin state, but cannot establish that every
external reference has disappeared. Neither a zero instance count nor successful
tests prove safe unloading.

The expected lifecycle is:

- Register the class lazily, once per plugin binary.
- Create and destroy editor instances and accessibility resources normally.
- Keep the registered class; never explicitly dispose of it.
- Do not artificially pin the module; the DAW and macOS determine image lifetime.

Closing an editor destroys its bridge, not necessarily the plugin instance.
Destroying all plugin instances does not necessarily trigger VST3 module
shutdown. Module shutdown and closing a loader handle do not necessarily mean
physical binary unloading. None of these events unregisters Soundor's class.
Physical unloading is the point at which retained method pointers can become
invalid; this policy does **not** guarantee safe binary unloading.

## Lifecycle cleanup

| Who                            | Owns / does                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `MacPlatform` (one per editor) | Strong container and element dictionary, semantic-tree mirror, channel token |
| Elements                       | Associated token, node id and offered actions; no C++ pointers               |
| Custom action blocks           | Weak element reference and plain action request; no C++ runtime pointer      |
| `Registry<Channel>`            | Token → weak request channel; tokens are never reused                        |
| AppKit / VoiceOver             | May independently retain elements, containers and custom actions             |

Before posting element-destroyed notifications, the bridge invalidates element
routing tags, clears custom actions and parent/child links, and marks elements
inactive. Removing a node therefore makes even externally retained actions
refuse requests. Full-tree replacement, deactivation and bridge destruction
also withdraw the channel token and discard pending requests. A fresh tree gets
a fresh token. A retained container is emptied and detached on destruction.
Repeated cleanup is safe. Opening another editor uses fresh runtime state and
the same binary's registered class.

The bridge registers no notification observers or asynchronous notification
callbacks. Its own notifications are synchronous posts. AppKit calls run on the
UI thread; requests are queued until `tick()` to avoid re-entering plugin code
from an accessibility call. The audio thread is untouched. Semantic node IDs
are never reused within the binary, so requests already queued for removed
nodes are also rejected by `SurfaceSemantics`.

**Live-instance diagnostics.** No class-wide counter is added here. Counting
Soundor's allocation call sites would miss externally allocated instances.
Overriding `alloc`/`allocWithZone:` and `dealloc` still misses direct runtime
allocation (`class_createInstance`) and requires care with subclass allocation,
initializer substitution, and deallocation overrides. Making that count reliable
would add lifecycle machinery beyond a lightweight diagnostic. Tests instead
use weak references and externally retained objects to check actual release and
invalidation. These checks are not evidence for class disposal or safe unloading.

`tests/apple/AppleHost.mm` loads two independent modules linked to the same
archive: it checks distinct classes, class reuse across instances, independent
action routing, destruction and recreation, and retained-element invalidation
while the implementation image is loaded. It then closes A's loader handle,
reports observed residency, and reloads A. This detects observed failures; it
does not prove physical unloading occurred or that unloading is safe. The same
tests run against the extracted prebuilt engine. `MacBridgeTests.mm` covers
retained custom actions, discarded pending work, runtime replacement and release
of elements even when a container survives.

## Coordinates

The semantic tree is in the surface's logical pixels. `ViewGeometry` gives
the surface's origin and scale in the view's points (y down). The bridge
converts that to the view's own coordinates, flipped or not, then through its
window to the screen. When the window moves, frames are refreshed on the next
tick, and only then.

## Notifications

Posted from each tick's changes, never every frame:

- value changed (a range, a check state, an input's text);
- title changed (a label);
- layout changed (elements added, removed or reordered, on the parent);
- focused element changed (keyboard focus);
- element destroyed.

A modal opening or closing is a layout change.

## Manual VoiceOver checklist

CI cannot run VoiceOver. Before calling macOS accessibility complete, go
through this with VoiceOver on (⌘F5), with the `primitives` example as a VST3
in hosts (Reaper, Cubase, Bitwig), and in the Soundor VST3 host:

- [ ] Plain text is read when the cursor reaches it.
- [ ] A labelled button ("Open dialog") is read as "Open dialog, button";
      VO-Space presses it once.
- [ ] A disabled button is read as dimmed and does nothing.
- [ ] A checkbox and a switch read their state; pressing toggles them and the
      new state is announced.
- [ ] An adjustable Gain control is read as a slider with its value text
      ("-3.5 dB"). VO-Shift-Up/Down (or VO-Up/Down while interacting)
      increments and decrements, and each new value is announced.
- [ ] Custom actions appear in the VO-⌘-Space actions menu and work.
- [ ] A TextInput is read as a text field with its value and placeholder;
      typing (with keyboard focus there) updates what is read.
- [ ] A Portal (dropdown) opened from a button is reachable.
- [ ] A Modal: only the dialog's content is reachable; Escape (or VO's
      cancel) closes it; focus returns.
- [ ] A nested Modal supersedes the outer one, and closing it returns to the
      outer one.
- [ ] The VO cursor outlines the elements in the right place after moving and
      resizing the editor window, and on a Retina and a non-Retina display.
- [ ] Closing and reopening the editor: VoiceOver still reads it, with no
      crash and no stale elements.
- [ ] Two instances of the plugin, and two different Soundor plugins, open
      at once: each reads its own controls.
- [ ] Removing the plugin from the session (the host may unload it) with
      VoiceOver on, then adding it again: no crash.

iOS: see [the iOS bridge](/docs/contribute/ios-accessibility).

The native macOS input adapter uses the same randomized class utility
(`src/platform/apple/RuntimeClass.mm`) and lifetime policy. Its transparent
child view is not an accessibility element; the editor's attachment
continues to expose Soundor's accessibility container. See
[Native input](./engine-reference#native-input) for responder ownership,
text input and teardown.
