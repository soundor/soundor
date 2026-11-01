# @soundor/vitest

## 0.15.0

### Minor Changes

- [#186](https://github.com/soundor/soundor/pull/186) [`96ef938`](https://github.com/soundor/soundor/commit/96ef938d7c0fc4dc745168a7083566400250a4a8) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `useViewSize()` in `@soundor/react` returns the plugin view's `{ width, height }` in logical pixels and its `scale` (device pixels per logical pixel), and re-renders when they change: the user resized the editor, a web host's embedding iframe changed size, or the view moved to a display of another density. It never re-renders for an unchanged size and does not poll. Underneath, `soundor:ui` has `subscribeViewSize(listener)`, and `viewSize()` is now the same frozen object until the size changes, so the pair works with `useSyncExternalStore`. The JUCE runtime tells subscribers once per change, on the editor's tick before the frame at the new size; the web runtime measures the view with the `ResizeObserver` that already updates hover, follows the page's pixel density and the host's scaling. In tests the view starts at the project's editor size, and `testView.resize()` changes it; the simulated `viewSize()` no longer throws.

### Patch Changes

- Updated dependencies [[`36e2599`](https://github.com/soundor/soundor/commit/36e2599acb42049a8b129055faf150af2e72874e), [`a71ac96`](https://github.com/soundor/soundor/commit/a71ac965bb43686143991a875cf162daed1cdc3b), [`6a677ac`](https://github.com/soundor/soundor/commit/6a677ac5d2d56b31f2101435ff6d3b69f31108db), [`96ef938`](https://github.com/soundor/soundor/commit/96ef938d7c0fc4dc745168a7083566400250a4a8)]:
  - @soundor/config@0.15.0
  - @soundor/test-runtime@0.15.0
  - @soundor/core@0.15.0

## 0.14.0

### Minor Changes

- [#180](https://github.com/soundor/soundor/pull/180) [`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Projects no longer list `@soundor/core`. It is now a regular dependency of every package that imports it, instead of a peer dependency the project had to provide. The CLI, `@soundor/config`, `@soundor/runtime-sdk` and `@soundor/vitest` pin the exact version their release group shares, so a project still gets one copy. The runtimes take it with a caret range. New projects from `create-soundor-app` no longer include it, and an existing project can remove it from its `devDependencies`.

### Patch Changes

- Updated dependencies [[`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba), [`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba), [`2a4f506`](https://github.com/soundor/soundor/commit/2a4f506dd54207a927aeccf4dc1267b0a2ebfe2c), [`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba), [`be7853c`](https://github.com/soundor/soundor/commit/be7853cc5ccbc2e402abb0dc42fe2a99a121e5dd), [`4588cca`](https://github.com/soundor/soundor/commit/4588cca3b50a0db869c8d220408dbf23c477f1f2), [`ce7601d`](https://github.com/soundor/soundor/commit/ce7601d1df6706d3d8957bb84247fee5568bd530), [`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba), [`2e2080e`](https://github.com/soundor/soundor/commit/2e2080e0e9d45ba6fa77a0ff4449b6db51fe25e8)]:
  - @soundor/core@0.14.0
  - @soundor/config@0.14.0
  - @soundor/test-runtime@0.14.0

## 0.13.0

### Patch Changes

- [#172](https://github.com/soundor/soundor/pull/172) [`57cfc9f`](https://github.com/soundor/soundor/commit/57cfc9f06bc074ae820def8797a4f44963711f79) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Update dependencies: `@fastify/static` 10, React 19.3.1, Vite 8.3.5, Vitest 5.0.5 and rolldown 1.2.15.
- Updated dependencies [[`57cfc9f`](https://github.com/soundor/soundor/commit/57cfc9f06bc074ae820def8797a4f44963711f79)]:
  - @soundor/config@0.13.0
  - @soundor/core@0.13.0
  - @soundor/test-runtime@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [[`e02159e`](https://github.com/soundor/soundor/commit/e02159eb8eb68a989a4dea8f405efdca9dff7798), [`3fe72a1`](https://github.com/soundor/soundor/commit/3fe72a188cef8f8a1b9eb4f49d5107cf41ac4096), [`4974b0d`](https://github.com/soundor/soundor/commit/4974b0dfbd49c801d61488341d6fa05d4c8b3239)]:
  - @soundor/config@0.12.0
  - @soundor/core@0.12.0
  - @soundor/test-runtime@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [[`35b671b`](https://github.com/soundor/soundor/commit/35b671bfab1197431ead7d0b2c6e3f967462a86a)]:
  - @soundor/core@0.11.0
  - @soundor/config@0.11.0
  - @soundor/test-runtime@0.11.0

## 0.10.1

### Patch Changes

- [#145](https://github.com/soundor/soundor/pull/145) [`1d7eb63`](https://github.com/soundor/soundor/commit/1d7eb63cc2c4288f05e34bdfe7cfc5af82ad4ccf) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Centralize guides and package references in `docs/`, with a documentation index,
  page navigation, and package README links that also work on npm. Add a project
  README and guides covering the idea, architecture, getting started, project
  lifecycle, parameters, and contributing.
- Updated dependencies [[`1d7eb63`](https://github.com/soundor/soundor/commit/1d7eb63cc2c4288f05e34bdfe7cfc5af82ad4ccf)]:
  - @soundor/config@0.10.1
  - @soundor/core@0.10.1
  - @soundor/test-runtime@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies [[`66210eb`](https://github.com/soundor/soundor/commit/66210eb00891368cf45d3847acb73e144d75c9d6)]:
  - @soundor/config@0.10.0
  - @soundor/core@0.10.0
  - @soundor/test-runtime@0.10.0

## 0.9.0

### Patch Changes

- [#137](https://github.com/soundor/soundor/pull/137) [`ee85daa`](https://github.com/soundor/soundor/commit/ee85daa245fe5f71f2faa90eafb9b86db2f6026a) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Name the source repository and directory in every package, so npm links each package to its source and resolves its README's relative links.
- Updated dependencies [[`99053ab`](https://github.com/soundor/soundor/commit/99053abfa9dc615ff9b81d6e2ec668e3d392288f), [`ee85daa`](https://github.com/soundor/soundor/commit/ee85daa245fe5f71f2faa90eafb9b86db2f6026a)]:
  - @soundor/core@0.9.0
  - @soundor/config@0.9.0
  - @soundor/test-runtime@0.9.0

## 0.8.0

### Minor Changes

- [#121](https://github.com/soundor/soundor/pull/121) [`f144eee`](https://github.com/soundor/soundor/commit/f144eeebc1dc22a6c7ff9614f85e301c1f102d4d) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add automatically registered Soundor focus assertions and focused simulated parameter,
  host and native mock setup helpers. React setup helpers commit subscription updates
  with act. Deprecate the Vitest runtime escape hatch and document behavior-based
  application animation tests while preserving runtime lifecycle coverage.

- [#115](https://github.com/soundor/soundor/pull/115) [`51d1f5d`](https://github.com/soundor/soundor/commit/51d1f5d012dab9e8cbc60c38fa74c2bde9e4d024) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add the Soundor Vitest plugin and simulated environment with virtual modules,
  per-test runtime isolation, deterministic service configuration, and published
  package consumer validation. Make React focus scopes read the active roots.

### Patch Changes

- [#118](https://github.com/soundor/soundor/pull/118) [`fe21a26`](https://github.com/soundor/soundor/commit/fe21a265d8bb993dd07eccd78587f5bab33b1cb3) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add Soundor Testing Library with semantic queries, stateful pointer and keyboard interactions, React rendering and cleanup, async assertions, and deterministic animation time. Align simulated mouse capture and event cancellation with native behavior and keep frame batches on the 60 Hz timeline.
- Updated dependencies [[`04ff5cf`](https://github.com/soundor/soundor/commit/04ff5cf759658cfda0f0ee748f1287fd29ee9848), [`7e5e33b`](https://github.com/soundor/soundor/commit/7e5e33b8aee3b3fbd07b1edab105b6d319843c7f), [`f144eee`](https://github.com/soundor/soundor/commit/f144eeebc1dc22a6c7ff9614f85e301c1f102d4d), [`9d8474e`](https://github.com/soundor/soundor/commit/9d8474ebfd40028eca8193a2bacaa248d17e3e5e), [`fe21a26`](https://github.com/soundor/soundor/commit/fe21a265d8bb993dd07eccd78587f5bab33b1cb3), [`51d1f5d`](https://github.com/soundor/soundor/commit/51d1f5d012dab9e8cbc60c38fa74c2bde9e4d024)]:
  - @soundor/config@0.8.0
  - @soundor/test-runtime@0.8.0
  - @soundor/core@0.8.0
