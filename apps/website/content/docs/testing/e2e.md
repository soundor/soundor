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

On Linux without a display, run it under `xvfb-run -a`.

A missing bundle fails the project once, before its tests, saying so. A bundle
out of date is not noticed, so rebuild after changing the plugin, as this script
does. In watch mode, a
changed test runs again against the same bundle.

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

```ts
await expect(plugin.getByText('Active')).toBeVisible();
await expect(plugin.getByText('Active')).not.toBeVisible({ timeout: 1000 });
await expect(plugin.getByDebugId('gain')).toHaveText(/^Gain: 0\.25/);
```

`timeout` is 5000 ms by default. With `.not`, they wait for the opposite. A value
from the host arrives in its own time as well, which is what Vitest's
`expect.poll` is for:

```ts
const bypass = plugin.parameter('Bypass');
await expect.poll(async () => (await bypass.get()).normalized).toBe(1);
```

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
- **Only inside a test:** both functions fail in `beforeAll` or at the top of a
  file, where nothing would close them. Call them in the test or a helper of it.
