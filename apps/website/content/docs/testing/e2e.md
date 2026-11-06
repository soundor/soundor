---
title: 'End-to-end tests'
description: 'Test a built VST3 plugin in Vitest: its real UI and its real audio together, in the VST3 host.'
---

`@soundor/vitest-e2e` tests the plugin itself. A test starts the built `.vst3`
in the real [VST3 host](/docs/testing/vst3-host) and checks its UI and its audio
together, with Vitest's own `test` and `expect`. Use it for what the
[simulated runtime](/docs/testing) cannot see: layout, the engine, native code
and sound.

```ts
import { launchPlugin } from '@soundor/vitest-e2e';
import { expect, test } from 'vitest';

test('bypass lets the input through', async () => {
  const plugin = await launchPlugin();

  await plugin.getByRole('button', { name: 'Bypass' }).click();
  await expect(plugin.getByText('Bypassed')).toBeVisible();

  const input = new Float32Array(4800).fill(0.5);
  const { outputs } = await plugin.host.process({ inputs: [[input, input]] });
  expect(outputs[0]![0]).toEqual(input);
});
```

## Setup

```sh
pnpm add -D vitest @soundor/vitest-e2e @soundor/vst3-host
```

Add the plugin to `vitest.config.ts`, with the path of the bundle to test:

```ts
import { soundor } from '@soundor/vitest-e2e';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    soundor({
      vst3: '.soundor/debug/juce/VST3/My Plugin.vst3',
    }),
  ],
  test: { include: ['e2e/**/*.test.ts'] },
});
```

Beside tests of the simulated runtime, each has a project of its own, and the
two plugins can be renamed where they are imported:

```ts
import { soundor as integration } from '@soundor/vitest';
import { soundor as e2e } from '@soundor/vitest-e2e';
import { defineConfig } from 'vitest/config';

const vst3 = '.soundor/debug/juce/VST3/My Plugin.vst3';

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [integration()],
        test: {
          name: 'integration',
          environment: 'soundor',
          include: ['src/**/*.test.tsx'],
        },
      },
      {
        plugins: [e2e({ vst3 })],
        test: { name: 'e2e', include: ['e2e/**/*.test.ts'] },
      },
    ],
  },
});
```

The tests run in Node, beside the plugin: they cannot import its components or
the `soundor:*` modules. The plugin raises the project's `testTimeout` to 30
seconds unless the project sets its own.

## Build first

Vitest does not build the plugin: tests use the bundle as it is. A test with a
UI needs a **Debug build of a Soundor plugin**, the only kind with DevTools, which
[`soundor build juce --debug`](/docs/cli/build#debug-builds) makes:

```json
{
  "scripts": {
    "test:e2e": "soundor build juce --debug && vitest run --project e2e"
  }
}
```

A missing bundle fails the project once, before its tests, saying so. A bundle
out of date is not noticed, so rebuild after changing the plugin, as this script
does. In watch mode, a
changed test runs again against the same bundle.

## A display

`launchPlugin()` opens the plugin's real editor. A VST3 editor is a native window
the host gives it, as a DAW does, so **tests with a UI need the system's window
API**, and there is no mode without a window. [`launchHost()`](#launchhost) opens
none and needs no display, so tests of audio, parameters and state run anywhere.

| System  | Window API | Tests with a UI need                                | Without it                                           |
| ------- | ---------- | --------------------------------------------------- | ---------------------------------------------------- |
| Linux   | X11        | `DISPLAY`: a desktop (XWayland on Wayland), or Xvfb | The launch fails: `no display is available`          |
| macOS   | Cocoa      | A logged-in desktop session, not a plain SSH one    | Not reliable: run them from a session with a desktop |
| Windows | Win32      | A desktop session, not a service's                  | Not reliable: run them from a session with a desktop |

On a desktop, **windows appear while the tests run** and can take focus, one for
each plugin started. Tests do not need them to stay on top: input goes through the
engine rather than the system, and screenshots are drawn by the engine rather than
read from the screen. For the same reason, a screenshot does not show what the
system's window manager adds or changes.

On Linux, Xvfb is a display with no screen. It keeps the windows out of sight on a
desktop, and is how tests run without one:

```sh
xvfb-run -a pnpm test:e2e
```

Install it with your system's packages: `xvfb` on Debian and Ubuntu,
`xorg-x11-server-Xvfb` on Fedora.

### On CI

GitHub's hosted runners have what this needs, and Soundor's own tests of
[Orbit](https://github.com/soundor/soundor/blob/main/.github/workflows/orbit.yml)
run on all three:

| Runner  | Setup                                                       |
| ------- | ----------------------------------------------------------- |
| Ubuntu  | `sudo apt-get install -y xvfb`, and run under `xvfb-run -a` |
| macOS   | None                                                        |
| Windows | None                                                        |

Building the plugin on Ubuntu also needs the packages JUCE needs, which that
workflow lists. A self-hosted runner needs the same as any machine: one that runs as
a background service may have no desktop session to open windows in.

## launchPlugin

```ts
const plugin = await launchPlugin(options?);
```

Starts the plugin with its editor open and its UI connected. It closes when the
test ends, however it ends. The test may also close it sooner with
`await plugin.close()`, and may start several, which are separate instances.

| Use                                                        | For                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `plugin.getByRole()`, `getByText()`, `getByDebugId()`      | [Locators](/docs/driver/inspecting#locators) of the UI                               |
| `plugin.pointer`, `plugin.keyboard`, `plugin.screenshot()` | [Input](/docs/driver/interacting) and captures                                       |
| `plugin.parameter('Gain')`                                 | A parameter by its title: `.get()` and `.set(0.25)`                                  |
| `plugin.host`                                              | Everything else of the [host](/docs/testing/vst3-host): audio, state, transport      |
| `plugin.openEditor()`                                      | Opens the editor again after `host.closeEditor()` or `host.recreate()`               |
| `plugin.driver`                                            | The [Driver](/docs/driver) of the current editor, for what the plugin does not offer |

Locators keep working when the editor is reopened. `options` are those of
[`launch()`](/docs/driver/vst3#options), with `plugin` naming another bundle than
the configured one.

## launchHost

```ts
const host = await launchHost(options?);
```

Loads the plugin without an editor, a display or DevTools, for audio,
parameters and state alone. It works with **any VST3 plugin**: a Release build,
or one not made with Soundor. It closes when the test ends.

```ts
test('state survives a save and restore', async () => {
  const first = await launchHost();
  await first.parameter('Gain').set(0.25);
  await first.process({ frames: 512 }); // the processor gets the change here
  const state = await first.getState();
  await first.close();

  const second = await launchHost({ sampleRate: 44_100 });
  await second.setState(state);
  const { normalized } = await second.parameter('Gain').get();
  expect(normalized).toBeCloseTo(0.25);
});
```

`options` are those of
[`launchHost()`](/docs/testing/vst3-host#choosing-the-plugin-class-and-setup),
without `editor`, and with `plugin` naming another bundle than the configured
one. To load a Release build for most tests, make it the configured `vst3`, and
name the Debug build in `launchPlugin({ plugin })`.

## Matchers

They take a locator and keep checking until they pass or `timeout` runs out, as
the plugin's UI reacts in its own time. So **always `await` them**: without it,
a test goes on without waiting and can pass without checking.

| Matcher                      | Passes when                                                            |
| ---------------------------- | ---------------------------------------------------------------------- |
| `toBeVisible(options?)`      | One node matches, and it is visible                                    |
| `toBeHidden(options?)`       | No node matches, or one that is not visible                            |
| `toHaveText(text, options?)` | One node matches, and its own text equals a string or matches a RegExp |
| `toBeChecked(options?)`      | One node matches, and it is checked (not `mixed`)                      |
| `toBeEnabled(options?)`      | One node matches, and it is not disabled                               |
| `toHaveFocus(options?)`      | One node matches, and it has keyboard focus                            |

```ts
await expect(plugin.getByText('Active')).toBeVisible();
await expect(plugin.getByText('Active')).not.toBeVisible({ timeout: 1000 });
await expect(plugin.getByDebugId('gain')).toHaveText(/^Gain: 0\.25/);
await expect(plugin.getByRole('switch', { name: 'Bypass' })).toBeChecked();
```

`toHaveFocus` here takes a locator; the one for the simulated runtime takes a node.
`timeout` is 5000 ms by default. With `.not`, they wait for the opposite. A value
from the host arrives in its own time as well, which is what Vitest's
`expect.poll` is for:

```ts
const bypass = plugin.parameter('Bypass');
await expect.poll(async () => (await bypass.get()).normalized).toBe(1);
```

## Screenshots

`toMatchScreenshot` checks that the plugin's view, or a locator's node, looks as
a saved image does:

```ts
await expect(plugin).toMatchScreenshot('bypassed');
await expect(plugin.getByDebugId('meter')).toMatchScreenshot('meter', {
  maxDiffPixels: 20,
});
```

The first run saves the image once two captures in a row agree, in
`__screenshots__/<test file>/<name>-<platform>.png` beside the test: commit it. On
CI, an image that is not there fails rather than being written. After a change you
meant, run Vitest with `-u` to save the new one. A mismatch leaves `actual.png`,
`expected.png` and `diff.png` under `.soundor/test-results/`.

| Option          | Default | Meaning                                                |
| --------------- | ------- | ------------------------------------------------------ |
| `timeout`       | `5000`  | Milliseconds to keep capturing before failing          |
| `threshold`     | `0.1`   | How different one pixel may be and still match, 0 to 1 |
| `maxDiffPixels` | `0`     | How many pixels may differ                             |
| `maxDiffRatio`  | `0`     | What share of the pixels may differ, 0 to 1            |

A different size never matches, whatever the tolerance. It has no `.not`, and
`name` is the test's name when left out. **Images are for one machine setup:** text
is drawn differently across systems and fonts, so the file name has the platform,
and images saved on a laptop may not match a CI machine of the same platform.
Save them where they will be checked, or allow for it with the options.

## When a test fails

A test that fails leaves what it saw in
`.soundor/test-results/<test file>/<test name>/`, and its error says where:

| File             | What                                          |
| ---------------- | --------------------------------------------- |
| `screenshot.png` | The view when the test ended (`launchPlugin`) |
| `tree.json`      | The UI's node tree (`launchPlugin`)           |
| `host.log`       | What the host and the plugin logged           |

A second plugin in the test adds `-2` to its names. What the plugin can no longer
give, after a crash, is left out, and saving never changes why the test failed.
Keep `.soundor` out of version control, as a new project does, and upload the folder
from CI to look at it there. `upload-artifact` skips hidden folders unless told not
to, and finds nothing otherwise:

```yaml
- uses: actions/upload-artifact@v7
  if: failure()
  with:
    name: e2e-results
    path: .soundor/test-results
    include-hidden-files: true
```

## Audio

`plugin.host.process()` and `host.process()` give audio as `Float32Array`s by bus
and channel, which the [host's guide](/docs/testing/vst3-host#processing-audio)
covers. These help make it and check it:

```ts
import { dominantFrequency, peak, sine } from '@soundor/vitest-e2e';

const tone = sine(440, { seconds: 0.5, amplitude: 0.5 });
const { outputs } = await host.process({ inputs: [[tone, tone]] });

expect(peak(outputs[0]!)).toBeCloseTo(0.25, 2);
expect(dominantFrequency(outputs[0]![0]!)).toBeCloseTo(440, 0);
expect(outputs[0]).toMatchAudioSnapshot('tone');
```

### Signals

Each returns a `Float32Array`. Options are `seconds` (1 by default) or `frames`,
`sampleRate` (48 000 by default), and `amplitude` (1 by default).

| Function             | Makes                                                      |
| -------------------- | ---------------------------------------------------------- |
| `sine(hz, options?)` | A sine wave, starting at zero                              |
| `noise(options?)`    | White noise, the same for the same `seed`, so tests repeat |
| `impulse(options?)`  | One sample of `amplitude` at frame `at` (0 by default)     |
| `silence(options?)`  | Zeros                                                      |

### Measuring

`peak(audio)` is the largest absolute sample and `rms(audio)` the root mean square,
of one channel or a whole bus. `dominantFrequency(channel, sampleRate?)` is the
strongest frequency in Hz, for a steady tone, and 0 for silence.

### Notes

`noteOn(pitch, options?)` and `noteOff(pitch, options?)` make `events`, with a
velocity of 0.8 by default instead of the host's 1:

```ts
await host.process({
  frames: 4800,
  events: [noteOn(60, { time: 10 }), noteOff(60, { time: 2400 })],
});
```

### Blocks

`render()` is `process()` as several calls, for bugs that show only at certain block
boundaries. `blockSize` is a size or several in turn, and each call's block is that
size, up to the host's `blockSize`. Events and parameter changes reach the call they
fall in, and the result is put back together.

```ts
const { outputs } = await render(host, {
  inputs: [[left, right]],
  blockSize: [37, 512, 64, 1],
});
expect(outputs[0]).toBeCloseToAudio(whole.outputs[0]!);
```

### Matchers

They take a channel or a bus, such as `outputs[0]`. Audio is already there when you
check it, so these do not retry and need no `await`.

| Matcher                                 | Passes when                                               |
| --------------------------------------- | --------------------------------------------------------- |
| `toBeSilent(options?)`                  | Nothing is above `threshold` (0.000001, about -120 dB)    |
| `toBeCloseToAudio(expected, options?)`  | Every sample is within `tolerance` (0.0001, about -80 dB) |
| `toMatchAudioSnapshot(name?, options?)` | As `toBeCloseToAudio`, against a saved WAV file           |

Both comparing matchers also take `sampleRate`, for the files they write. A mismatch
says where the audio first differs and how many samples do, and leaves `actual.wav`
and `expected.wav` under `.soundor/test-results/` to listen to.

`toMatchAudioSnapshot` saves `__snapshots__/<test file>/<name>.wav` beside the test
the first time: commit it. On CI, a file that is not there fails rather than being
written, and `-u` saves a new one, as for
[screenshots](#screenshots). The files are 32-bit float, so keep them short: a stereo
second is about 384 KB. A plugin's output can differ slightly across systems, which
is what `tolerance` is for.

### WAV files

`readWav(path)` reads PCM of 8, 16, 24 or 32 bits or 32-bit float, as `{ sampleRate,
channels }`. `writeWav(path, { sampleRate, channels })` writes 32-bit float, making
its folder if needed.

## Good to know

- **Parameter titles:** a title several parameters share fails, naming them,
  except for a JUCE plugin with a Bypass of its own: JUCE adds another for hosts,
  and the title means the plugin's.
- **Parallel files:** each plugin has its own process and session, and input goes
  through the engine, so test files can run in parallel. Within a file, tests run
  one at a time: `launchPlugin()` belongs to the running test, so `test.concurrent`
  is not supported.
- **`ctx.skip()`:** Vitest does not run a test's cleanup when the test skips itself,
  so a plugin started before it stays open until the test run ends. Skip first.
- **Resizing:** the editor takes a new size in its own time, after
  `host.resizeEditor()` returns, so wait for what you check:
  `await expect.poll(async () => (await plugin.screenshot()).width).toBe(1600)`.
- **A hang on Windows:** MSVC's Debug runtime reports a failed check, such as an index
  out of range, in a dialog that nothing answers on CI. A test can then time out with
  no error from the plugin, where other systems pass. The bug is still in the plugin:
  look for it in the C++ the test runs.
- **Only inside a test:** both functions fail in `beforeAll` or at the top of a
  file, where nothing would close them. Call them in the test or a helper of it.
