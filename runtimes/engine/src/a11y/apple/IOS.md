# The iOS bridge

`IosPlatform.mm` presents the semantic tree to VoiceOver on iOS as virtual
`UIAccessibilityElement`s. It follows the macOS bridge's rules (`README.md`):

- one runtime-made element class per binary, with a random,
  ABI-namespaced name, from `AppleShared.mm`;
- no swizzling, and no change to any UIKit or framework class;
- elements that reach their bridge by token only;
- the binary pinned once the class exists;
- requests performed by `tick()` on the UI thread.

## State

Soundor has no iOS plugin build yet (no AUv3 target, no iOS runtime). So the
bridge is built, not run:

- the `soundor_ios_bridge_builds` test compiles it, with the platform-neutral
  a11y code, for the iOS simulator on every macOS CI run;
- `createPlatformAccessibility()` returns it on iOS.

Nothing here has met VoiceOver on a device. Treat it as unverified until the
checklist below has been done.

## What a runtime has to provide

The same attachment as on macOS, in UIKit's terms:

1. Create the bridge with the `UIView` the surface is drawn in:
   `a11y::createPlatformAccessibility({ { (__bridge void*) view, nullptr }, name })`.
2. Put `accessibilityContainer()` (a system `UIAccessibilityElement` that is
   not an element itself) in the view's `accessibilityElements`. With JUCE's
   iOS peer, that is `AccessibilityHandler::setNativeChildForComponent`, as
   on macOS. The view must not be an accessibility element itself.
3. Every frame, on the main thread, after `RuntimeHost::tick()`: call
   `setGeometry({ x, y, scale })`, the surface's origin and scale in the view's
   points (y down), then `tick(host)`.
4. Destroy the bridge before the `RuntimeHost`, and before the view goes away.

## How VoiceOver's gestures map

| VoiceOver                        | Element method                                      | Soundor                                                                                                  |
| -------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Double tap                       | `accessibilityActivate`                             | `activate`, if offered; otherwise VoiceOver taps the element's centre, which reaches the view as a touch |
| Swipe up / down on an adjustable | `accessibilityIncrement` / `accessibilityDecrement` | `increment` / `decrement`; the new value is announced once plugin code has set it                        |
| Two-finger scrub (Z)             | `accessibilityPerformEscape`                        | `escape` (a Modal closes)                                                                                |
| Actions rotor                    | `accessibilityCustomActions`                        | custom actions, `longpress`, `expand`, `collapse`                                                        |

Traits carry the role:

- button, link, image, static text, header, adjustable, search field and
  keyboard key;
- tab bar for a tab list;
- updates-frequently for progress and timers;
- toggle button for switches and checkboxes (iOS 17 and later);
- not-enabled and selected for those states.

An element with children that is not read as a whole (a dialog, a toolbar)
is not an element itself: iOS would hide its children. It is a semantic group
holding them. A modal sets `accessibilityViewIsModal`, and opening or closing
one posts a screen change.

## Device checklist

On an iPhone or iPad with VoiceOver on, once a runtime hosts Soundor on iOS:

- [ ] A labelled button is read with its trait; double tap presses it once.
- [ ] Static text is read.
- [ ] A switch and a checkbox read their state; double tap toggles them.
- [ ] An adjustable Gain control: swipe up and down change it, and the new
      value ("-3.0 dB") is spoken.
- [ ] Custom actions appear in the actions rotor and work.
- [ ] A TextInput is reachable and takes text with the on-screen keyboard.
- [ ] A Modal: only its content is reachable; the two-finger scrub closes it.
- [ ] A Portal opened inside a Modal is reachable; the background is not.
- [ ] A nested Modal supersedes the outer one until it closes.
- [ ] Rotating the device or resizing the view keeps the VoiceOver cursor on
      the right controls.
- [ ] Closing and reopening the plugin view: no stale or missing elements.
- [ ] Two instances of the plugin, where the host allows: each reads its own.
