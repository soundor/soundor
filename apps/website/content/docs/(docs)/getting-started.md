---
title: 'Getting started'
description: 'Create a project, connect the UI, add the browser runtime, test, and build.'
---

This guide creates a VST3 plugin, explains the generated project, and shows how
to add the browser runtime. To explore Soundor without a native toolchain, use
the repository's [browser example](#try-the-repository-example).

## Requirements

Use Node.js `%node%`, and pnpm or npm. Soundor supports these two package
managers only: Yarn's Plug'n'Play leaves no `node_modules` for native builds to
find packages in, and bun is untested.

Install Rust stable with Cargo. Both runtimes compile the plugin's Rust audio
processor. Web builds additionally need `rustup target add wasm32-unknown-unknown`.
Soundor checks these tools with `doctor` and never installs them automatically.

VST3 builds also need the platform's linker: a C++ compiler driver on Linux
(g++ or clang++), Apple's Command Line Tools on macOS, Visual Studio or its
Build Tools on Windows. No C++ is compiled per plugin, and no CMake is
needed. Run `soundor doctor` to check the toolchain. See
[the VST3 runtime's requirements](/docs/vst3-runtime#requirements).

The browser runtime needs Rust, Node.js and a browser, with no C++ build. Audio starts
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
installs dependencies, and runs `soundor gen` to create the Rust crate. Both
VST3 and Web manage their hosts inside their packages; neither needs runtime
initialization or a `runtimes/` directory. Choose VST3 (the default), web,
or both. VST3 projects include the Soundor VST3 host: `pnpm dev` opens the
plugin in it, which needs a graphical desktop. See
[`soundor dev`](/docs/cli/dev).

Soundor is pre-1.0, and a minor release (0.10 to 0.11) can change its APIs. The
new project therefore pins each direct Soundor dependency exactly. The
scaffolder starts with package-specific tested versions and can select older
compatible versions when those are unavailable under the package manager's
policy. The CLI, config and React share a release; the runtimes and VST3 host
have their own versions. See [Dependency versions](/docs/cli/create-soundor-app#dependency-versions)
before upgrading.

The template includes a gain control UI and one Rust gain processor shared by
both runtimes. Implement audio behavior in `lib/src/processor.rs`; declaring a
parameter does not apply it to the audio automatically. See
[Rust audio processing](/docs/rust-processor).

## Understand the files

```text
my-plugin/
  soundor.config.ts        plugin identity, parameters, native API, runtimes
  src/index.tsx            renders the UI
  src/App.tsx              shared TypeScript/React UI
  rust-toolchain.toml      Rust stable, generated once
  lib/Cargo.toml           your Rust crate and dependencies
  lib/Cargo.lock           locked Rust dependency versions
  lib/src/lib.rs           registers the controller and processor
  lib/src/controller.rs    required controller and instance stores
  lib/src/processor.rs     shared Rust audio processor
  tsconfig.json            UI types, including generated declarations
  .soundor/
    generated/            generated types and runtime framework
    ui/                   bundled UI and assets
    dist/                 runtime build output
```

You own `src/`, `lib/`, the toolchain file and the config.
`src/` contains the Soundor UI; `lib/` is the cross-platform Rust library
containing both the processor and controller. The `native` API
(`native.methods`, `native.events`, and `soundor:native`) describes communication
between the UI and its host, including in a browser. Soundor owns
`.soundor/`, which is disposable build output. `gen` creates a Rust starter crate
when its manifest is absent, leaves existing crates untouched, and rewrites the derived files in `.soundor/`. See [Project lifecycle](/docs/project-lifecycle).

If you create the project from scratch or upgrade an existing project, use
the [UI TypeScript setup](/docs/cli/ui-bundle#typescript), including
`"customConditions": ["soundor"]`, so library types match the implementation
selected by the bundler. The scaffolder sets this up automatically.

## Declare the plugin contract

The scaffold creates a config like this:

```ts
import { defineSoundorConfig } from '@soundor/config';
import { vst3Runtime } from '@soundor/vst3-runtime';

export default defineSoundorConfig({
  plugin: { id: 'com.example.my-plugin', name: 'My Plugin' },
  runtimes: [vst3Runtime()],
  parameters: {
    gain: { type: 'float32', label: 'Gain', min: 0, max: 1, default: 0.5 },
  },
});
```

Choose a stable, globally unique `plugin.id` before release. Hosts and saved
sessions use its derived identities. `plugin.name` is the display name.

Run `pnpm gen` after editing the contract to refresh editor types. Restart
`pnpm dev` after config changes. UI and Rust crate edits rebuild
automatically during development.

The plugin links the prebuilt engine of the exact `@soundor/engine` version
the runtime depends on, downloaded once and verified. See
[Soundor Engine](/docs/engine).

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
        onPress={() => parameters.gain.set(parameters.gain.info.default)}
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

Choose the web runtime along with VST3 when you create the project, and it is
set up already: run it with `pnpm dev:web`.

To add it to an existing project, install the web runtime:

```sh
pnpm add @soundor/web-runtime
```

Import `webRuntime` from `@soundor/web-runtime` in `soundor.config.ts` and append
`webRuntime()` to the existing `runtimes` array. The host is managed by Soundor;
there is no web initialization step. Add these scripts to `package.json`:

```json
"build:vst3": "soundor build vst3",
"build:web": "soundor build web",
"dev:web": "soundor dev web",
"typecheck": "soundor gen && tsc -b"
```

For optional custom inputs, add a [browser TypeScript project](/docs/web-runtime#browser-typescript-environment).

Then run it with `pnpm dev:web`.

Open the URL printed by the CLI. Your shared `src/main.tsx` runs inside the
browser host, and so does your audio processing: the Rust crate in `lib/`,
compiled to WebAssembly (it needs `rustup target add wasm32-unknown-unknown`).
`lib/src/controller.rs` implements your configured native API for the
browser and VST3 plugin alike.

Press Play in the host to enable audio. The
[web runtime guide](/docs/web-runtime) explains the host, storage, transport,
shared Rust native API, and browser limitations.

## Test and build

The [testing guide](/docs/testing) explains how to install the Vitest integration
and Testing Library. Tests can render the real React components against a
simulated runtime without opening a plugin or a browser.

```sh
pnpm typecheck
pnpm test:rust
pnpm build
```

`pnpm build` builds every configured runtime; with several, `pnpm build:vst3`
and `pnpm build:web` build one. The VST3 bundle is under
`.soundor/dist/vst3/`; the browser build is a static site under
`.soundor/dist/web/`. Platform-specific details are in the
[VST3 guide](/docs/vst3-runtime) and [web guide](/docs/web-runtime).

## Try the repository example

From a checkout of Soundor, build the workspace packages and start the basic
example in the browser:

```sh
pnpm install
pnpm build
pnpm --filter basic dev:web
```

This path needs no native build. The example uses both managed runtimes and includes
one shared Rust gain processor and application tests. See
[Basic example](/docs/examples/basic) for its file map and
[Contributing](/docs/contribute) for repository checks.

## Migrating the Rust library directory

If your project uses `native/Cargo.toml`, rename the user-owned `native/`
directory to `lib/`, update Cargo manifest paths in scripts and editor tooling,
and run `soundor gen`. Keep the Cargo package name and the processor/controller
exports unchanged. The relative dependency on `.soundor/generated/rust/soundor`
stays the same. Both VST3 and Web build this library with Cargo.

Soundor rejects the old layout and also rejects projects with both
`native/Cargo.toml` and `lib/Cargo.toml`. Resolve which crate to keep in `lib/`
yourself; Soundor never renames or deletes user files. The native methods/events
API and platform-native C++ directories are unaffected.
