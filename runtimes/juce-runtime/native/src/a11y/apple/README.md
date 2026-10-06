# Soundor's Apple accessibility bridge

On macOS, VoiceOver perceives a Soundor view through virtual
`NSAccessibilityElement`s that Soundor creates from its own semantic tree
(`a11y::SurfaceSemantics`). There is one element per semantic element, not one
`NSView` per node. The Skia surface stays a single custom-drawn view. AccessKit's
Apple adapters and JUCE's `AccessibilityHandler` are not involved.

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

- **JUCE:** the peer's `NSView` takes its accessibility children from JUCE's
  element tree. The generated editor passes the container to
  `juce::AccessibilityHandler::setNativeChildForComponent(editor, container)`,
  JUCE's public hook for native children. It passes the editor's own JUCE
  element as `accessibilityParent`. JUCE only exposes the container: no
  semantics come from it, and no JUCE class is changed.
- **A framework with its own view (iPlug2):** set the view's accessibility
  children to the container's children, or return them from its
  `accessibilityChildren`, and pass the view as `handle`.

## Plugin safety

A host process may load several Soundor plugins, several versions of
Soundor, VST3 and AU builds of one plugin, plugins that use JUCE or AccessKit
themselves, and unload any of them. The Objective-C class namespace is
process-global; C++ symbol hiding does nothing for it.

- **Shared with iOS.** `AppleShared.mm` holds what both bridges do the same
  way: making the class, tagging elements, the token registry and request
  queue. Each platform has its own file for what differs.
- **One runtime class, never a fixed name.** The only class Soundor adds is
  the element class: a subclass of `NSAccessibilityElement`, made with
  `objc_allocateClassPair` the first time a bridge activates. Its name is
  `SoundorAXElement_<ABI namespace>_<128 random bits>`, checked against
  `objc_getClass` before it is registered. Two copies of one plugin, its
  VST3 and AU builds, and two Soundor versions all get different classes.
  Every element of one binary shares that one class.
- **Why a class at all:** VoiceOver's press, increment, decrement and cancel
  are methods on the element (`accessibilityPerformPress` …), and so is
  setting a value. A system-class element cannot answer them. Everything
  else uses system classes: the container is a plain `NSAccessibilityElement`,
  and custom actions are `NSAccessibilityCustomAction` with a block.
- **Nothing else is modified.** No swizzling, no categories, no changes to
  `NSView`, `NSWindow` or the framework's classes. The subclass only adds
  methods to itself.

## Lifecycle

| Who                            | Owns / does                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `MacPlatform` (one per editor) | the container, a dictionary of its elements (strong), its mirror of the tree, a token |
| Elements                       | an associated token, node id and offered actions; nothing that points at C++          |
| `Registry<Channel>`            | token → weak channel (request queue); never destroyed                                 |
| AppKit / VoiceOver             | whatever elements and custom actions it chooses to keep, for as long as it likes      |

- **Element removed from the tree:** `NSAccessibilityUIElementDestroyedNotification`
  is posted and the bridge drops it. A request VoiceOver still makes through
  it is queued under its old node id, which `SurfaceSemantics` refuses: ids
  are never reused.
- **Editor closes / plugin instance destroyed:** `~MacPlatform` posts
  destroyed notifications for every element, empties the container, and
  withdraws its token. The editor first detaches the container from JUCE. A
  message to an element VoiceOver kept finds no channel for its token and
  returns `NO`. Nothing is dereferenced.
- **Assistive technology turns off:** the bridge drops its elements the same
  way and stays idle. Turning on rebuilds the whole tree.
- **Reload (`soundor dev`):** a new `RuntimeHost` means new ids. The bridge
  sends the whole new tree and drops requests made against the old one.
- **Module unload:** the element class's methods, and the custom actions'
  blocks, are code in the plugin binary. AppKit and VoiceOver may keep
  elements indefinitely, with no notice when they let go, so freeing the class
  (`objc_disposeClassPair`) or unloading the code can never be proven safe.
  So when the class is created, the binary is pinned
  (`dlopen(RTLD_NOLOAD | RTLD_NODELETE)` on itself). From then on, `dlclose`
  by the host leaves it loaded, and every method and block stays valid. The
  class is never disposed. A plugin whose editor never ran with VoiceOver
  (or Switch Control) on creates no class and is not pinned.
- **Threads:** AppKit calls on the main thread, which is the plugin's UI
  thread. Requests are still queued and performed by `tick()`, so plugin code
  runs at a known point and never re-enters from inside an AppKit call.
  Nothing touches the audio thread.

`tests/apple/AppleHost.mm` checks this in one process with two plugin
binaries (different ABI namespaces):

- both load and create bridges, with distinct classes;
- two instances of one plugin share its class and keep separate trees;
- presses reach the right plugin;
- after one plugin is destroyed and `dlclose`d, it stays loaded, an element
  held from it refuses to act, and the other keeps working;
- the plugin loads and works again.

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
through this with VoiceOver on (⌘F5), with the `primitives` example as an AU
and as a VST3 in a host (Logic, Reaper), and in the Standalone app:

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

iOS: see [`IOS.md`](IOS.md).
