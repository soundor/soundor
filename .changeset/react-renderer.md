---
'@soundor/react': minor
'@soundor/core': minor
'soundor': minor
'@soundor/config': minor
'@soundor/runtime-sdk': minor
'create-soundor-app': minor
---

`@soundor/react`: React for plugin UIs, rendering into the plugin view.

- A react-reconciler renderer for `soundor:ui`: `render()`, `createRoot()`, `flushSync()`.
- React Native–style components: `View`, `Text` (strings and nested `<Text>` flattened), `Image`, `ScrollView` (`contentContainerStyle`), `TextInput` (`value`/`onChangeText`, `onSubmitEditing`), `Pressable` (state-dependent `style` and `children`), with Web-style event props and capture variants.
- `StyleSheet`, style arrays, and hooks: `useParameter()` and `useAnimationFrame()`.
- `@soundor/core` ships the project-independent runtime declarations (`@soundor/core/runtime/ui.d.ts`, `globals.d.ts`) for packages written against `soundor:ui`.
- **Breaking:** the previous `@soundor/react` (hooks over the WebView bridge) is replaced entirely.
