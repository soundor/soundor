---
'@soundor/web-runtime': minor
---

The web host opens the plugin view at the config's `editor` size (800×600 by default, as before), which the manifest now carries, rather than a size of its own. A resizable editor (`editor.resizable`) gets a handle just outside the view's corner in the `demo` and `dev` presentations: dragging it (or the arrow keys, with it focused) changes the view's logical size within the editor's limits and the page's room, so the UI is laid out again rather than scaled; a drag the browser cancels puts the size back. A fixed editor is scaled down to fit a smaller page as before, and `?embed` still fills its iframe, following it as the parent page resizes it.
