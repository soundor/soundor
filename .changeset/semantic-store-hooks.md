---
'@soundor/react': minor
'@soundor/environment': minor
---

Add hooks for the external state a plugin UI reads, so a component no longer calls `useSyncExternalStore` on a `soundor:*` module: `useEditorVisibility()`, `useEditorFocus()`, `useEditorSize()` (the editor's own size, beside `useViewSize()`), `useHostState()`, `usePresetSelection()` and `useNativeStream(stream)`. Each takes the same stable snapshots the modules already supplied, so it re-renders once per change and subscribes while the component is mounted. `useParameter()`, `useStateValue()` and `useNativeStream()` now subscribe once for as long as their source stays the same, where `useParameter()` and `useStateValue()` subscribed again on every render. The docs, examples and `soundor:*` declarations use the hooks.
