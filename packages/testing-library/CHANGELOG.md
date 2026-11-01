# @soundor/testing-library

## 0.15.0

### Minor Changes

- [#186](https://github.com/soundor/soundor/pull/186) [`96ef938`](https://github.com/soundor/soundor/commit/96ef938d7c0fc4dc745168a7083566400250a4a8) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `useViewSize()` in `@soundor/react` returns the plugin view's `{ width, height }` in logical pixels and its `scale` (device pixels per logical pixel), and re-renders when they change: the user resized the editor, a web host's embedding iframe changed size, or the view moved to a display of another density. It never re-renders for an unchanged size and does not poll. Underneath, `soundor:ui` has `subscribeViewSize(listener)`, and `viewSize()` is now the same frozen object until the size changes, so the pair works with `useSyncExternalStore`. The JUCE runtime tells subscribers once per change, on the editor's tick before the frame at the new size; the web runtime measures the view with the `ResizeObserver` that already updates hover, follows the page's pixel density and the host's scaling. In tests the view starts at the project's editor size, and `testView.resize()` changes it; the simulated `viewSize()` no longer throws.

### Patch Changes

- Updated dependencies [[`160322b`](https://github.com/soundor/soundor/commit/160322b55e64b29e545ec4c50fc0849dc525b598), [`6a677ac`](https://github.com/soundor/soundor/commit/6a677ac5d2d56b31f2101435ff6d3b69f31108db), [`96ef938`](https://github.com/soundor/soundor/commit/96ef938d7c0fc4dc745168a7083566400250a4a8)]:
  - @soundor/react@0.15.0
  - @soundor/test-runtime@0.15.0

## 0.14.0

### Minor Changes

- [#185](https://github.com/soundor/soundor/pull/185) [`be7853c`](https://github.com/soundor/soundor/commit/be7853cc5ccbc2e402abb0dc42fe2a99a121e5dd) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Pointer events have `movementX`/`movementY`: how far the pointer moved since its previous event, in logical pixels. A node can lock the pointer while it is pressed, for knobs and faders that turn past the screen's edge: `node.requestPointerLock()` (from `pointerdown`) hides the pointer, the screen's edges no longer stop it, its events stay at the position the lock began with only the movement changing, and on release (or `exitPointerLock()`) the pointer shows again where it began. `pointerLockNode()` is the node holding it. The JUCE runtime keeps the hidden pointer in the view, moving it back as it strays, and ends the lock however the press ends; the web runtime uses the browser's Pointer Lock. The implicit pointer capture now starts before the `pointerdown` listeners run, so they can lock the press. The test runtime and `user.pointer` support both.

### Patch Changes

- Updated dependencies [[`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba), [`2a4f506`](https://github.com/soundor/soundor/commit/2a4f506dd54207a927aeccf4dc1267b0a2ebfe2c), [`be7853c`](https://github.com/soundor/soundor/commit/be7853cc5ccbc2e402abb0dc42fe2a99a121e5dd), [`ce7601d`](https://github.com/soundor/soundor/commit/ce7601d1df6706d3d8957bb84247fee5568bd530)]:
  - @soundor/react@0.14.0
  - @soundor/test-runtime@0.14.0

## 0.13.0

### Patch Changes

- [#172](https://github.com/soundor/soundor/pull/172) [`57cfc9f`](https://github.com/soundor/soundor/commit/57cfc9f06bc074ae820def8797a4f44963711f79) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Update dependencies: `@fastify/static` 10, React 19.3.1, Vite 8.3.5, Vitest 5.0.5 and rolldown 1.2.15.
- Updated dependencies [[`57cfc9f`](https://github.com/soundor/soundor/commit/57cfc9f06bc074ae820def8797a4f44963711f79)]:
  - @soundor/react@0.13.0
  - @soundor/test-runtime@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [[`4974b0d`](https://github.com/soundor/soundor/commit/4974b0dfbd49c801d61488341d6fa05d4c8b3239)]:
  - @soundor/react@0.12.0
  - @soundor/test-runtime@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [[`35b671b`](https://github.com/soundor/soundor/commit/35b671bfab1197431ead7d0b2c6e3f967462a86a)]:
  - @soundor/react@0.11.0
  - @soundor/test-runtime@0.11.0

## 0.10.1

### Patch Changes

- [#145](https://github.com/soundor/soundor/pull/145) [`1d7eb63`](https://github.com/soundor/soundor/commit/1d7eb63cc2c4288f05e34bdfe7cfc5af82ad4ccf) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Centralize guides and package references in `docs/`, with a documentation index,
  page navigation, and package README links that also work on npm. Add a project
  README and guides covering the idea, architecture, getting started, project
  lifecycle, parameters, and contributing.
- Updated dependencies [[`1d7eb63`](https://github.com/soundor/soundor/commit/1d7eb63cc2c4288f05e34bdfe7cfc5af82ad4ccf)]:
  - @soundor/test-runtime@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies []:
  - @soundor/react@0.10.0
  - @soundor/test-runtime@0.10.0

## 0.9.0

### Patch Changes

- [#137](https://github.com/soundor/soundor/pull/137) [`ee85daa`](https://github.com/soundor/soundor/commit/ee85daa245fe5f71f2faa90eafb9b86db2f6026a) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Name the source repository and directory in every package, so npm links each package to its source and resolves its README's relative links.
- Updated dependencies [[`ee85daa`](https://github.com/soundor/soundor/commit/ee85daa245fe5f71f2faa90eafb9b86db2f6026a)]:
  - @soundor/react@0.9.0
  - @soundor/test-runtime@0.9.0

## 0.8.0

### Minor Changes

- [#121](https://github.com/soundor/soundor/pull/121) [`f144eee`](https://github.com/soundor/soundor/commit/f144eeebc1dc22a6c7ff9614f85e301c1f102d4d) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add automatically registered Soundor focus assertions and focused simulated parameter,
  host and native mock setup helpers. React setup helpers commit subscription updates
  with act. Deprecate the Vitest runtime escape hatch and document behavior-based
  application animation tests while preserving runtime lifecycle coverage.

- [#118](https://github.com/soundor/soundor/pull/118) [`fe21a26`](https://github.com/soundor/soundor/commit/fe21a265d8bb993dd07eccd78587f5bab33b1cb3) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add Soundor Testing Library with semantic queries, stateful pointer and keyboard interactions, React rendering and cleanup, async assertions, and deterministic animation time. Align simulated mouse capture and event cancellation with native behavior and keep frame batches on the 60 Hz timeline.

### Patch Changes

- Updated dependencies [[`f144eee`](https://github.com/soundor/soundor/commit/f144eeebc1dc22a6c7ff9614f85e301c1f102d4d), [`5caf476`](https://github.com/soundor/soundor/commit/5caf476f4956e5e87f98fdad8ccdc97e187668a0), [`9d8474e`](https://github.com/soundor/soundor/commit/9d8474ebfd40028eca8193a2bacaa248d17e3e5e), [`fe21a26`](https://github.com/soundor/soundor/commit/fe21a265d8bb993dd07eccd78587f5bab33b1cb3), [`51d1f5d`](https://github.com/soundor/soundor/commit/51d1f5d012dab9e8cbc60c38fa74c2bde9e4d024)]:
  - @soundor/test-runtime@0.8.0
  - @soundor/react@0.8.0
