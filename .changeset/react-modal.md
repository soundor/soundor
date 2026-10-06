---
'@soundor/react': minor
---

`Modal`: an in-view modal layer, built on `Portal` and `FocusScope`. It is not a window: it is drawn in the plugin's one view.

- A `Portal` entry with a backdrop over the whole view that blocks the pointer from everything below (transparent by default; `backdropStyle` styles it), and the children above it.
- A trapped, autofocusing, focus-restoring `FocusScope`: focus goes to the first focusable child on open, Tab stays inside, focus returns on close. With nothing focusable inside, background focus is dropped so keys cannot reach it.
- Escape, and with `dismissOnBackdropPress` a press on the backdrop itself, call `onRequestClose`; `visible` (default `true`) keeps control with the caller. Escape goes to the topmost modal.
- Modals stack like portals: one opened from another is above it and owns focus, and portals opened from a modal show above it inside its focus trap.

Also: a trapping `FocusScope` drops focus that is outside it when it starts, and `Pressable` callbacks update React at the same priority as event props, so a press renders before the next task.
