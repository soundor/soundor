# @soundor/driver

## 0.14.0

### Patch Changes

- Updated dependencies []:
  - @soundor/devtools-protocol@0.14.0

## 0.13.0

### Minor Changes

- [#164](https://github.com/soundor/soundor/pull/164) [`f75bc0c`](https://github.com/soundor/soundor/commit/f75bc0ca9a76077bdb9b3e7df28cfa5d3b3dbab2) Thanks [@dm-balakin](https://github.com/dm-balakin)! - DevTools targets have no owner any more: every signed-in client (dashboard tabs, Soundor Driver, `soundor driver`) reads, highlights, picks, records and sends input at the same time, as several mice and keyboards share one computer. The engine keeps each client's synthetic pointer, held keys, highlight and picker apart, draws every client's highlight, and releases only a client's own input when it disconnects. The performance recording is shared and stops once every client that started it is gone.

  Breaking: the protocol is version 2. `Control.acquire`/`Control.release`, `LEASE_BUSY`/`LEASE_REQUIRED` and targets' `controller` are removed; runtime requests carry the sending `client`, and `resetControl` is replaced by `clientGone`. The Driver drops `acquireControl()`, `releaseControl()` and `hasControl`; the dashboard drops **Request control**; `soundor driver` exit code 6 now means the target is busy.

### Patch Changes

- Updated dependencies [[`f75bc0c`](https://github.com/soundor/soundor/commit/f75bc0ca9a76077bdb9b3e7df28cfa5d3b3dbab2)]:
  - @soundor/devtools-protocol@0.13.0

## 0.12.0

### Minor Changes

- [#163](https://github.com/soundor/soundor/pull/163) [`e02159e`](https://github.com/soundor/soundor/commit/e02159eb8eb68a989a4dea8f405efdca9dff7798) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Soundor Driver screenshots: the engine captures its view as it renders it, as PNG (`capture` capability, `Capture.screenshot`), and the JUCE bridge uploads it to the DevTools server as binary, which keeps it as a short-lived capture clients read with their session cookie (bounded in size, number and lifetime). `driver.screenshot()`, `locator.screenshot()` and `soundor driver screenshot <path>` save it; DevTools previews and downloads it. Locators gain `waitFor()` and `isVisible()`, and a missing debug ID lists the ones there are.

- [#162](https://github.com/soundor/soundor/pull/162) [`3fe72a1`](https://github.com/soundor/soundor/commit/3fe72a188cef8f8a1b9eb4f49d5107cf41ac4096) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Soundor Driver input: the engine dispatches synthetic pointer, wheel and keyboard input through its own hit testing, capture and event dispatch (`input` capability; `Input.dispatchPointer`, `dispatchWheel`, `dispatchKey`, `typeText`, `focus` and `UI.hitTest` in the DevTools protocol), on a pointer of its own, and releases whatever it holds when control is released, the client goes or the UI reloads. `@soundor/driver` adds `pointer`, `keyboard`, control leases and locator actions (`click`, `hover`, `drag`, `dragTo`, `scroll`, `focus`, `press`, `type`) that wait until a node is actionable; `soundor driver` adds `click`, `hover`, `focus`, `move`, `drag`, `scroll`, `key` and `type`; DevTools offers Click, Hover and Focus on the selected node. The engine decodes runtime commands itself, and `Surface::key(input, typed)` is the shared key entry of the JUCE editor and synthetic input.

- [#160](https://github.com/soundor/soundor/pull/160) [`4974b0d`](https://github.com/soundor/soundor/commit/4974b0dfbd49c801d61488341d6fa05d4c8b3239) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Soundor Driver: `@soundor/driver` connects to a running plugin's DevTools session as a control client and inspects its native UI (targets, the node tree, node details, and lazy locators by debug ID, role or text); `soundor driver targets|tree|inspect` does the same from the command line, with `--json` output and stable exit codes. Components take a `debugId` prop (`node.debugId` in `soundor:ui`), which DevTools shows and the Driver finds nodes by.

### Patch Changes

- Updated dependencies [[`e02159e`](https://github.com/soundor/soundor/commit/e02159eb8eb68a989a4dea8f405efdca9dff7798), [`3fe72a1`](https://github.com/soundor/soundor/commit/3fe72a188cef8f8a1b9eb4f49d5107cf41ac4096)]:
  - @soundor/devtools-protocol@0.12.0
