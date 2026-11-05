---
title: 'Plugins in the VST3 host'
description: 'Launch a Debug build of a plugin in the standalone VST3 host and work with its UI and its audio in one script.'
---

`@soundor/driver/vst3` runs a plugin as a host would: it starts a private
DevTools session, loads the `.vst3` bundle in
[`@soundor/vst3-host`](/docs/testing/vst3-host), opens the editor, and gives
you a [Driver](/docs/driver) for its UI beside the host for its audio. A click
in the UI and the audio it changes can be checked in the same script.

```sh
pnpm add -D @soundor/driver @soundor/vst3-host
```

The host is an optional peer of the Driver: nothing else in `@soundor/driver`
needs it, and it installs a native executable.

```ts
import { launch } from '@soundor/driver/vst3';

const plugin = await launch({
  plugin:
    '.soundor/cache/juce/build-debug/MyPlugin_artefacts/Debug/VST3/MyPlugin.vst3',
  sampleRate: 48_000,
});
try {
  await plugin.driver.getByDebugId('bypass').click();

  const input = new Float32Array(4800).fill(0.5);
  const { outputs } = await plugin.host.process({ inputs: [[input, input]] });
  console.log(outputs[0]![0]![4799]);

  await plugin.driver.screenshot({ path: './bypassed.png' });
} finally {
  await plugin.close();
}
```

`driver` is an ordinary [Driver](/docs/driver/inspecting), and `host` an
ordinary [`Vst3Host`](/docs/testing/vst3-host). A failed UI call is a
`DriverError`, a failed host call a `Vst3HostError`.

## What it can load

The plugin must be a **Debug build of a Soundor plugin**: only those have
DevTools. `soundor dev juce` builds one at the path above, among its
`Plugins`, and leaves it there when stopped. Its UI still reloads when
`soundor dev` rebuilds it, and the Driver follows, as with any
[reload](/docs/driver/connecting#targets).

For a Release build, or a plugin not made with Soundor, the editor opens but
no UI connects, and `launch()` fails with `NO_TARGETS` after `targetTimeout`.
Those can still be loaded with `launchHost()`, for their audio and parameters.

An editor needs a window, so a display: on Linux CI, run under `xvfb-run`.
Without one, `launch()` fails with the host's `no-display`.

## Options

`launch()` takes the options of
[`launchHost()`](/docs/testing/vst3-host#choosing-the-plugin-class-and-setup),
except `editor`, which is always on, and two of its own:

| Option           | Default | Meaning                                                    |
| ---------------- | ------- | ---------------------------------------------------------- |
| `targetTimeout`  | `10000` | Milliseconds for the UI to connect once the editor is open |
| `commandTimeout` | `10000` | Milliseconds to wait for each Driver command               |

`signal` cancels launching only. `presentation` chooses how the editor is
shown, as for the host; `SOUNDOR_DEVTOOLS_SESSION` in `env` is replaced by the
private session's.

## When the editor closes

A target is one editor, so one Driver works with one editor. When it closes
(`host.closeEditor()`, `host.recreate()`, the user closing its window), that
Driver's calls fail with `TARGET_DISCONNECTED`. `openEditor()` opens it again
and makes a new Driver, so read `plugin.driver` afterwards, and make new
[locators](/docs/driver/inspecting#locators) from it:

```ts
await plugin.host.recreate(); // A fresh instance has no editor.
await plugin.openEditor();
await plugin.driver.getByDebugId('bypass').click();
```

`openEditor({ presentation: 'host' })` on an open editor opens it again in
that presentation, with a new Driver too. On an editor that stays as it is,
`openEditor()` keeps the Driver. Call it rather than `host.openEditor()`, which
opens the editor but leaves `plugin.driver` as it was.

If the host crashes, Driver calls fail with `TARGET_DISCONNECTED` and host
calls with `host-exited`, which says what the plugin last logged. If it crashes
before the UI connects, `launch()` fails with that error.

## Closing

`close()` ends the host and the session, whose descriptor is deleted with it.
It is idempotent and safe after a crash; the plugin also supports `await using`.

## Sharing the session

The session is private to this `Vst3Plugin` and has no dashboard. While it
runs, the CLI can reach it through its descriptor:

```sh
soundor driver tree --descriptor "$DESCRIPTOR_PATH"
```

Here, `DESCRIPTOR_PATH` is `plugin.descriptorPath`. To load a plugin in the
session of a running `soundor dev` instead, use the two packages directly: pass
that session's descriptor as `SOUNDOR_DEVTOOLS_SESSION` in `launchHost()`'s
`env`, and [`connect()`](/docs/driver/connecting) with a `targetId`.
