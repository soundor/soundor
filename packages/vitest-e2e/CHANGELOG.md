# @soundor/vitest-e2e

## 0.16.0

### Minor Changes

- [#217](https://github.com/soundor/soundor/pull/217) [`cdb88a2`](https://github.com/soundor/soundor/commit/cdb88a2b2dd41a9267b5ea7c685d99023abb3220) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add audio helpers: `sine`, `noise`, `impulse` and `silence`; `peak`, `rms` and `dominantFrequency`; `noteOn` and `noteOff`; `render()`, which processes a request in chosen block sizes; `readWav` and `writeWav`; and the `toBeSilent`, `toBeCloseToAudio` and `toMatchAudioSnapshot` matchers.

- [#216](https://github.com/soundor/soundor/pull/216) [`8e00a56`](https://github.com/soundor/soundor/commit/8e00a56c539437d5019ec494d730a360775b29f6) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add the `toBeChecked`, `toBeEnabled`, `toHaveFocus` and `toMatchScreenshot` matchers. A failed test now leaves a screenshot, the UI tree and the host's log in `.soundor/test-results/`.

- [#214](https://github.com/soundor/soundor/pull/214) [`cdbebe4`](https://github.com/soundor/soundor/commit/cdbebe4624eeb57c7d7be6840d10e2a0e92b2cf7) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add `@soundor/vitest-e2e`: Vitest tests of a built VST3 plugin in the real host, with `launchPlugin()`, `launchHost()`, the `soundor({ vst3 })` plugin and the `toBeVisible`, `toBeHidden` and `toHaveText` matchers. `Vst3Plugin` from `@soundor/driver/vst3` gains locators that survive a reopened editor, `pointer`, `keyboard`, `screenshot()` and `parameter()`. `Vst3Host` gains `parameter(title)`.

### Patch Changes

- [#215](https://github.com/soundor/soundor/pull/215) [`9e4c0ef`](https://github.com/soundor/soundor/commit/9e4c0efa87a2743965921a0590c61f161faeb0bf) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add `soundor build juce --debug`: a one-shot Debug build with DevTools and the UI embedded, for tests, in `.soundor/debug/juce/<format>/`. Add `--out <dir>` to `soundor build`, for releases and debug builds.
- Updated dependencies [[`c6a011f`](https://github.com/soundor/soundor/commit/c6a011f5fcbe805ff4c9def2b1d3ddc50dadf89b), [`cdbebe4`](https://github.com/soundor/soundor/commit/cdbebe4624eeb57c7d7be6840d10e2a0e92b2cf7)]:
  - @soundor/driver@0.16.0
