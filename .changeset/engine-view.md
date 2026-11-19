---
'@soundor/engine': minor
---

`view::View` (`soundor/view/View.h`): what every runtime's editor does with the engine, in one place. It owns the runtime (a `RuntimeHost`, or a `DevSession` under `soundor dev`), places the UI in the editor, picks the compositor (the GPU in the native view where there is one, the CPU otherwise, and the CPU for good once the GPU is lost), reads native input or takes the framework's, and handles the pointer lock, the cursor, accessibility and, in Debug builds, DevTools. `frame()` runs a frame in one fixed order. `resized()` places the UI at once and presents it on the GPU at the new size. The editor implements `view::Platform`: the native view, its size, scale and focus, the cursor, and editor sizes. `view::place()` (`soundor/view/Layout.h`) places the UI for soundor.config's `editor` (`resize`, `fit`, the maximum size).
