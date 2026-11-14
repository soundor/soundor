# @soundor/vitest-e2e

## 0.18.0

### Patch Changes

- [#301](https://github.com/soundor/soundor/pull/301) [`523dacc`](https://github.com/soundor/soundor/commit/523dacc94f532d589600232df16e6b4fc7e0ef65) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Clean up lint warnings and update callback references after React commits, keeping installed listeners stable.
- Updated dependencies [[`523dacc`](https://github.com/soundor/soundor/commit/523dacc94f532d589600232df16e6b4fc7e0ef65)]:
  - @soundor/driver@0.18.0

## 0.17.1

### Patch Changes

- [#298](https://github.com/soundor/soundor/pull/298) [`582aeec`](https://github.com/soundor/soundor/commit/582aeec3a8191fc664d4a426dd295557918be8ee) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Publish all packages through npm trusted publishing with GitHub Actions OIDC.
- Updated dependencies [[`582aeec`](https://github.com/soundor/soundor/commit/582aeec3a8191fc664d4a426dd295557918be8ee)]:
  - @soundor/driver@0.17.1

## 0.17.0

### Minor Changes

- [#275](https://github.com/soundor/soundor/pull/275) [`6cfc628`](https://github.com/soundor/soundor/commit/6cfc628494cb431a15d98f50d7c696ba19a89348) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Narrow the `@soundor/vst3-host` peer dependency to a caret range matching the host release used for development, instead of accepting every pre-1.0 minor. This supports patches in the current minor without claiming compatibility with future breaking host API changes. The host remains optional for the Driver and JUCE runtime and required for Vitest E2E.

### Patch Changes

- [#261](https://github.com/soundor/soundor/pull/261) [`ca998c9`](https://github.com/soundor/soundor/commit/ca998c9f20b6d455d4a33778fd05601868208c3a) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Default E2E polling assertions to five seconds so native host and UI reads have time to complete. Preserve explicit project and per-assertion timeouts.
- Updated dependencies [[`3275981`](https://github.com/soundor/soundor/commit/32759813fd8c6ef0f59fa10f7d2c2dc6e2f291a3), [`d5b9b16`](https://github.com/soundor/soundor/commit/d5b9b167c52bea1113785d84d62fb78e8409d06d), [`6cfc628`](https://github.com/soundor/soundor/commit/6cfc628494cb431a15d98f50d7c696ba19a89348)]:
  - @soundor/driver@0.17.0

## 0.16.0

### Minor Changes

- [#217](https://github.com/soundor/soundor/pull/217) [`cdb88a2`](https://github.com/soundor/soundor/commit/cdb88a2b2dd41a9267b5ea7c685d99023abb3220) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add audio helpers: `sine`, `noise`, `impulse` and `silence`; `peak`, `rms` and `dominantFrequency`; `noteOn` and `noteOff`; `render()`, which processes a request in chosen block sizes; `readWav` and `writeWav`; and the `toBeSilent`, `toBeCloseToAudio` and `toMatchAudioSnapshot` matchers.

- [#216](https://github.com/soundor/soundor/pull/216) [`8e00a56`](https://github.com/soundor/soundor/commit/8e00a56c539437d5019ec494d730a360775b29f6) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add the `toBeChecked`, `toBeEnabled`, `toHaveFocus` and `toMatchScreenshot` matchers. A failed test now leaves a screenshot, the UI tree and the host's log in `.soundor/test-results/`.

- [#214](https://github.com/soundor/soundor/pull/214) [`cdbebe4`](https://github.com/soundor/soundor/commit/cdbebe4624eeb57c7d7be6840d10e2a0e92b2cf7) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add `@soundor/vitest-e2e`: Vitest tests of a built VST3 plugin in the real host, with `launchPlugin()`, `launchHost()`, the `soundor({ vst3 })` plugin and the `toBeVisible`, `toBeHidden` and `toHaveText` matchers. `Vst3Plugin` from `@soundor/driver/vst3` gains locators that survive a reopened editor, `pointer`, `keyboard`, `screenshot()` and `parameter()`. `Vst3Host` gains `parameter(title)`.

### Patch Changes

- [#215](https://github.com/soundor/soundor/pull/215) [`9e4c0ef`](https://github.com/soundor/soundor/commit/9e4c0efa87a2743965921a0590c61f161faeb0bf) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add `soundor build juce --debug`: a one-shot Debug build with DevTools and the UI embedded, for tests, in `.soundor/debug/juce/<format>/`. Add `--out <dir>` to `soundor build`, for releases and debug builds.
- Updated dependencies [[`c6a011f`](https://github.com/soundor/soundor/commit/c6a011f5fcbe805ff4c9def2b1d3ddc50dadf89b), [`cdbebe4`](https://github.com/soundor/soundor/commit/cdbebe4624eeb57c7d7be6840d10e2a0e92b2cf7)]:
  - @soundor/driver@0.16.0
