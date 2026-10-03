# @soundor/juce-runtime

**The official reference Soundor runtime.** It hosts the React UI inside a JUCE
`WebBrowserComponent`, implements DSP with JUCE-native APIs, binds parameters
through an `AudioProcessorValueTreeState`, and owns the build/packaging and dev
workflows for VST3/AU. It is the proof the Soundor runtime contract works
end-to-end.

## Usage

```ts
// soundor.config.ts
import { defineSoundorConfig } from '@soundor/config';
import { juceRuntime } from '@soundor/juce-runtime';

export default defineSoundorConfig({
  runtimes: [
    juceRuntime({
      plugin: {
        formats: ['vst3', 'au'],
        pluginName: 'My Plugin',
      },
      // JUCE is never downloaded automatically — point at a checkout you accept
      // the license for (or set JUCE_DIR / add a ./JUCE submodule).
      jucePath: './JUCE',
    }),
  ],
  parameters: [
    {
      type: 'float',
      id: 'gain',
      label: 'Gain',
      min: 0,
      max: 1,
      default: 0.5,
      unit: 'dB',
    },
  ],
});
```

### Lifecycle phases

| Phase    | What it does                                                                                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`   | Scaffolds the **user-owned** host under `runtimes/juce/` (`CMakeLists.txt`, `PluginProcessor`, `PluginEditor`). Written once; idempotent.                                                                         |
| `gen`    | Emits the **generated framework** under `.soundor/generated/runtimes/juce/`: `setup.cmake` + the `soundor::` base classes (APVTS layout, WebView bridge, allowlist, manifest). Ephemeral — regenerated every run. |
| `dev`    | Debug CMake build with the WebView pointed at the CLI's Vite dev server for fast UI iteration.                                                                                                                    |
| `build`  | Embeds the CLI-built production React bundle and produces packaged VST3/AU under `.soundor/dist/juce`.                                                                                                            |
| `doctor` | Verifies CMake, a C++ compiler, and a locatable JUCE checkout.                                                                                                                                                    |

### init vs gen: you own the host, Soundor owns the framework

`gen` produces the config-derived framework — the `soundor::AudioProcessor` /
`soundor::AudioProcessorEditor` base classes and a `setup.cmake` — into
`.soundor/generated/`. It is ephemeral and reproducible (`gen --check` is stable).

`init` scaffolds the host you own: thin `PluginProcessor`/`PluginEditor`
subclasses of those bases, and a `CMakeLists.txt` whose **only** Soundor-injected
line is `include(...setup.cmake)`. Edit any of it freely — re-running `init`
never overwrites existing files. App-specific behavior that isn't derived from
config (e.g. audio-level metering streamed to the UI via `onFrame()`) lives in
the scaffold, not in `gen`.

The UI bundler is owned by the **CLI**, not the runtime: `dev` receives the Vite
dev-server URL (`ctx.dev.ui.url`) and `build` receives the built assets dir
(`ctx.build.ui.dir`). The runtime never invokes Vite itself.

## JUCE is required (and never downloaded)

JUCE ships under a license that requires explicit acceptance, so this runtime
never fetches it. It resolves an existing checkout in order:

1. `juceRuntime({ jucePath })`
2. the `JUCE_DIR` variable (CMake's `<package>_DIR` convention — set it as an
   environment variable, or pass `-DJUCE_DIR=...` at configure time)
3. conservative well-known paths: `./JUCE`, `~/JUCE`, `~/SDKs/JUCE`, plus
   `/opt/JUCE` on Linux, `/Applications/JUCE` and `/opt/JUCE` on macOS, and
   `C:\JUCE` and `C:\SDKs\JUCE` on Windows

A directory counts as JUCE when it carries the top-level `CMakeLists.txt` and
`modules/`. `soundor doctor` reports exactly where it looked when JUCE is
missing.

## The bridge

The React UI talks to the plugin through the browser bridge exported from
`@soundor/juce-runtime/bridge`. The CLI wires it into the app via the
runtime-agnostic `bridgeModule()` seam, exposed as the virtual module
`virtual:soundor/bridge`:

```ts
import { bridge } from 'virtual:soundor/bridge';
import { SoundorProvider } from '@soundor/react';
```

The bridge speaks a small JSON envelope protocol over the WebView channel
(`window.__JUCE__`) that the generated C++ `soundor::AudioProcessorEditor`
implements, including the 60fps DSP→UI telemetry stream (subscribe with
`useEvent`/`useEventValue`).
In a plain browser preview (no WebView) it degrades to the in-memory mock so the
UI still renders.

### Native-call security defaults

- **Deny-by-default allowlist.** `callNative` rejects any method not declared in
  the config's `nativeMethods`. The allowlist is generated into both the C++
  editor (`SoundorEditor.cpp`) and the injected manifest (`window.__SOUNDOR__`),
  so the JS and native views cannot drift — and the native side enforces it
  independently of the UI.
- **Payload validation.** Native-call payloads must be JSON-serializable and
  within 64 KB (`DEFAULT_MAX_PAYLOAD_BYTES`); oversized or cyclic payloads are
  rejected before reaching the transport.
- **Message correlation.** Each call carries a monotonic id; only a matching
  `result` frame resolves it. Malformed inbound frames are ignored rather than
  crashing the UI.

## Native runtime (in progress)

[`native/`](./native) holds the C++ runtime that will replace the WebView: an
embedded QuickJS-NG engine running the plugin's UI JavaScript on the UI thread,
with Soundor-controlled module loading and no browser or Node globals. It is
built and tested on its own (`pnpm test` includes it). The current WebView
pipeline described above does not use it yet. See
[`native/README.md`](./native/README.md).

## License

MIT
