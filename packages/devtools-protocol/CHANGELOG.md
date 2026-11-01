# @soundor/devtools-protocol

## 0.15.0

No changes in this release.

## 0.14.0

No changes in this release.

## 0.13.0

### Minor Changes

- [#164](https://github.com/soundor/soundor/pull/164) [`f75bc0c`](https://github.com/soundor/soundor/commit/f75bc0ca9a76077bdb9b3e7df28cfa5d3b3dbab2) Thanks [@dm-balakin](https://github.com/dm-balakin)! - DevTools targets have no owner any more: every signed-in client (dashboard tabs, Soundor Driver, `soundor driver`) reads, highlights, picks, records and sends input at the same time, as several mice and keyboards share one computer. The engine keeps each client's synthetic pointer, held keys, highlight and picker apart, draws every client's highlight, and releases only a client's own input when it disconnects. The performance recording is shared and stops once every client that started it is gone.

  Breaking: the protocol is version 2. `Control.acquire`/`Control.release`, `LEASE_BUSY`/`LEASE_REQUIRED` and targets' `controller` are removed; runtime requests carry the sending `client`, and `resetControl` is replaced by `clientGone`. The Driver drops `acquireControl()`, `releaseControl()` and `hasControl`; the dashboard drops **Request control**; `soundor driver` exit code 6 now means the target is busy.

## 0.12.0

### Minor Changes

- [#163](https://github.com/soundor/soundor/pull/163) [`e02159e`](https://github.com/soundor/soundor/commit/e02159eb8eb68a989a4dea8f405efdca9dff7798) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Soundor Driver screenshots: the engine captures its view as it renders it, as PNG (`capture` capability, `Capture.screenshot`), and the JUCE bridge uploads it to the DevTools server as binary, which keeps it as a short-lived capture clients read with their session cookie (bounded in size, number and lifetime). `driver.screenshot()`, `locator.screenshot()` and `soundor driver screenshot <path>` save it; DevTools previews and downloads it. Locators gain `waitFor()` and `isVisible()`, and a missing debug ID lists the ones there are.

- [#162](https://github.com/soundor/soundor/pull/162) [`3fe72a1`](https://github.com/soundor/soundor/commit/3fe72a188cef8f8a1b9eb4f49d5107cf41ac4096) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Soundor Driver input: the engine dispatches synthetic pointer, wheel and keyboard input through its own hit testing, capture and event dispatch (`input` capability; `Input.dispatchPointer`, `dispatchWheel`, `dispatchKey`, `typeText`, `focus` and `UI.hitTest` in the DevTools protocol), on a pointer of its own, and releases whatever it holds when control is released, the client goes or the UI reloads. `@soundor/driver` adds `pointer`, `keyboard`, control leases and locator actions (`click`, `hover`, `drag`, `dragTo`, `scroll`, `focus`, `press`, `type`) that wait until a node is actionable; `soundor driver` adds `click`, `hover`, `focus`, `move`, `drag`, `scroll`, `key` and `type`; DevTools offers Click, Hover and Focus on the selected node. The engine decodes runtime commands itself, and `Surface::key(input, typed)` is the shared key entry of the JUCE editor and synthetic input.

## 0.11.0

No changes in this release.

## 0.10.1

### Patch Changes

- [#145](https://github.com/soundor/soundor/pull/145) [`1d7eb63`](https://github.com/soundor/soundor/commit/1d7eb63cc2c4288f05e34bdfe7cfc5af82ad4ccf) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Centralize guides and package references in `docs/`, with a documentation index,
  page navigation, and package README links that also work on npm. Add a project
  README and guides covering the idea, architecture, getting started, project
  lifecycle, parameters, and contributing.

## 0.10.0

No changes in this release.

## 0.9.0

### Patch Changes

- [#137](https://github.com/soundor/soundor/pull/137) [`ee85daa`](https://github.com/soundor/soundor/commit/ee85daa245fe5f71f2faa90eafb9b86db2f6026a) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Name the source repository and directory in every package, so npm links each package to its source and resolves its README's relative links.

## 0.8.0

### Minor Changes

- [#127](https://github.com/soundor/soundor/pull/127) [`640fca8`](https://github.com/soundor/soundor/commit/640fca812d39e560c89494b645169e0377df7e32) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Expose real native animation snapshots and bounded lifecycle events, plus explicit performance recording of measured UI tick, layout, raster, frame and compositor work. Add animation and performance panels to DevTools with controller-only recording and safe reload/disconnect cleanup. Keep inspection read-only where reconciler-safe property overrides or source metadata are unavailable.

- [#124](https://github.com/soundor/soundor/pull/124) [`2807b91`](https://github.com/soundor/soundor/commit/2807b91593c45278d51e400892b399368e1f55c7) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Connect JUCE development Standalones to the designated DevTools session through asynchronous authenticated IPC. Inspect actual native nodes, styles, layout, accessibility and focus, render independent CPU/GPU highlight layers, and intercept native picker clicks safely across disconnects and reloads. Exclude the bridge from production builds.

- [#123](https://github.com/soundor/soundor/pull/123) [`7e5e33b`](https://github.com/soundor/soundor/commit/7e5e33b8aee3b3fbd07b1edab105b6d319843c7f) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add the versioned Soundor Debug Protocol and local development session server with browser WebSockets, authenticated asynchronous native IPC, instance routing, generation validation, control leases, bounded subscriptions and lifecycle cleanup.
