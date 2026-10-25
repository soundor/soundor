---
title: 'Getting started'
description: 'Create a project, connect the UI, add the browser runtime, test, and build.'
---

This guide creates a JUCE plugin, explains the generated project, and shows how
to add the browser runtime. To explore Soundor without a native toolchain, use
the repository's [browser example](#try-the-repository-example).

## Requirements

Use Node.js `%node%`, and pnpm or npm. Soundor supports these two package
managers only: Yarn's Plug'n'Play leaves no `node_modules` for native builds to
find packages in, and bun is untested.

Native builds also need CMake, a C++20 compiler, and a JUCE checkout. Plugin
builds use Ninja on macOS and Linux, and Visual Studio on Windows. Source engine
builds additionally need the tools described in [Soundor Engine](/docs/engine#prebuilt-and-source-mode).

Soundor discovers JUCE in standard locations, including `/opt/JUCE` on Linux,
or through `jucePath` or `JUCE_DIR`. You provide the JUCE checkout; Soundor never
downloads it. Run `soundor doctor` to check discovery and toolchain setup. See
[JUCE resolution](/docs/juce-runtime#juce-is-required-and-never-downloaded) for the
complete search order.

The browser runtime needs Node.js and a browser, with no C++ build. Audio starts
after a user gesture in the browser host.

## Create a project

```sh
pnpm create soundor-app@%version:create-soundor-app% my-plugin
cd my-plugin
pnpm doctor
pnpm dev
```

With npm, run `npm create soundor-app@%version:create-soundor-app% my-plugin`,
then `npm run doctor` and `npm run dev`. The version is the current
release; naming it keeps the scaffolder, and so the new project, on the version
these docs describe.

The scaffolder prompts for the runtime and package manager, copies the template,
installs dependencies, and runs `soundor init`. It currently offers the JUCE
runtime, with VST3 and Standalone formats. Native development builds and launches
the Standalone; it needs a graphical desktop to open the window.

Soundor is pre-1.0, and a minor release (0.10 to 0.11) can change its APIs. The
new project therefore pins each Soundor package to the exact version the
scaffolder was released with. Upgrade them together, after reading their
changelogs.

The template includes a gain control UI and a JUCE processor scaffold. Implement
your audio behavior in the processor; declaring a parameter does not apply it to
the audio automatically.

## Understand the files

```text
my-plugin/
  soundor.config.ts        plugin identity, parameters, native API, runtimes
  src/main.tsx             shared TypeScript/React UI
  tsconfig.json            UI types, including generated declarations
  runtimes/juce/           your CMake project, processor, and editor
  .soundor/
    generated/            generated types and runtime framework
    ui/                   bundled UI and assets
    dist/                 runtime build output
```

You own `src/`, the config, and the files under `runtimes/`. Soundor owns
`.soundor/`, which is disposable build output. `init` preserves existing host
files; `gen` rewrites generated files. See [Project lifecycle](/docs/project-lifecycle).

## Declare the plugin contract

The scaffold creates a config like this:

```ts
import { defineSoundorConfig } from '@soundor/config';
import { juceRuntime } from '@soundor/juce-runtime';

export default defineSoundorConfig({
  plugin: { id: 'com.example.my-plugin', name: 'My Plugin' },
  runtimes: [juceRuntime({ formats: ['vst3', 'standalone'] })],
  parameters: [
    { type: 'float', id: 'gain', label: 'Gain', min: 0, max: 1, default: 0.5 },
  ],
});
```

Choose a stable, globally unique `plugin.id` before release. Hosts and saved
sessions use its derived identities. `plugin.name` is the display name.

Run `pnpm gen` after editing the contract to refresh editor types. Restart
`pnpm dev` after config or native code changes. Ordinary UI edits rebuild
automatically during development.

Published JUCE runtimes use a matching prebuilt engine by default. A checkout of
this monorepo has no published-engine manifest, so its examples use
`juceRuntime({ engine: { mode: 'source' } })`. See [Engine modes](/docs/engine).

## Connect the UI

Replace `src/main.tsx` with a small parameter-aware UI:

```tsx
import { Pressable, Text, View, render, useParameter } from '@soundor/react';
import { parameters } from 'soundor:parameters';

function App() {
  const gain = useParameter(parameters.gain);
  return (
    <View style={{ flex: 1, padding: 20, gap: 12 }}>
      <Text>Gain: {gain.toFixed(2)}</Text>
      <Pressable
        accessibilityLabel="Reset gain"
        onPress={() => {
          parameters.gain.beginGesture();
          try {
            parameters.gain.set(parameters.gain.info.default);
          } finally {
            parameters.gain.endGesture();
          }
        }}
      >
        <Text>Reset</Text>
      </Pressable>
    </View>
  );
}

render(<App />);
```

`useParameter` subscribes to the runtime's parameter value. Calling `set`
updates that parameter; gestures tell the native host which edits belong to a
user action. For continuous controls and host automation, read
[Parameters](/docs/parameters). The [React reference](/docs/react) covers styles,
events, canvases, focus, accessibility, and animations.

## Add the browser runtime

Choose the web runtime along with JUCE when you create the project, and it is
set up already: run it with `pnpm dev:web`.

To add it to an existing project, install the web runtime:

```sh
pnpm add @soundor/web-runtime
```

Import `webRuntime` from `@soundor/web-runtime` in `soundor.config.ts` and append
`webRuntime()` to the existing `runtimes` array. Then initialize it, once:

```sh
pnpm exec soundor init web
```

and give `package.json` the scripts a new project with both runtimes has (the
Web host's code has its own tsconfig, so `typecheck` checks it separately):

```json
"build:juce": "soundor build juce",
"build:web": "soundor build web",
"dev:web": "soundor dev web",
"typecheck": "soundor gen && tsc -b && tsc -p runtimes/web"
```

Then run it with `pnpm dev:web`.

Open the URL printed by the CLI. Your shared `src/main.tsx` runs inside the
browser host. `runtimes/web/src/audio.ts` is where you connect a Web Audio graph;
`src/native.ts` in that same host directory implements your configured native
API. These are separate implementations from the JUCE processor and C++ API.

For the declared `gain` parameter, an audio implementation can be:

```ts
import type { WebAudioSetup } from '@soundor/web-runtime/client';
import { parameters } from 'soundor:parameters';

export const setupAudio: WebAudioSetup = ({ context, input, output }) => {
  const gain = context.createGain();
  gain.gain.value = parameters.gain.get();
  const unsubscribe = parameters.gain.subscribe((value) =>
    gain.gain.setTargetAtTime(value, context.currentTime, 0.01),
  );
  input.connect(gain);
  gain.connect(output);
  return () => {
    unsubscribe();
    input.disconnect();
    gain.disconnect();
  };
};
```

Press Play in the host to enable audio. The
[web runtime guide](/docs/web-runtime) explains the host, storage, transport,
TypeScript native API, and browser limitations.

## Test and build

The [testing guide](/docs/testing) explains how to install the Vitest integration
and Testing Library. Tests can render the real React components against a
simulated runtime without opening a plugin or a browser.

```sh
pnpm typecheck
pnpm build
```

`pnpm build` builds every configured runtime; with several, `pnpm build:juce`
and `pnpm build:web` build one. Native output lives under
`.soundor/dist/juce/`; the browser build is a static site under
`.soundor/dist/web/`. Platform-specific details are in the
[JUCE guide](/docs/juce-runtime) and [web guide](/docs/web-runtime).

## Try the repository example

From a checkout of Soundor, build the workspace packages and start the basic
example in the browser:

```sh
pnpm install
pnpm build
pnpm --filter basic dev:web
```

This path needs no JUCE or native engine build. The example already includes
both host projects, a gain processor for each, and application tests. See
[Basic example](/docs/examples/basic) for its file map and
[Contributing](/docs/contribute) for repository checks.
