<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/soundor-logo-on-dark.svg">
  <img alt="Soundor" src="assets/brand/soundor-logo.svg" height="64">
</picture>

Build audio plugin UIs in TypeScript and React, and run the same UI in a native
VST3 plugin or a browser.

A Soundor project declares its identity, parameters, typed native API, and
runtimes in `soundor.config.ts`. Soundor generates the shared contract, bundles
the UI, and builds each runtime. You write the audio processing once, in Rust:
it runs natively in the plugin and as WebAssembly in the browser.

```tsx
import { Pressable, Text, View, render, useParameter } from '@soundor/react';
import { parameters } from 'soundor:parameters';

function Gain() {
  const gain = useParameter(parameters.gain);
  return (
    <View style={{ padding: 20, gap: 12 }}>
      <Text>Gain: {gain.toFixed(2)}</Text>
      <Pressable onPress={() => parameters.gain.set(0.5)}>
        <Text>Reset</Text>
      </Pressable>
    </View>
  );
}

render(<Gain />);
```

This UI expects a `gain` parameter in the project configuration. The
[getting started guide](https://soundor.dev/docs/getting-started) walks through the configuration
and a working project.

## Two runtimes, one UI

| Runtime                                       | UI implementation                                                                         | Audio implementation                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [VST3](https://soundor.dev/docs/vst3-runtime) | Hermes runs the UI; Yoga lays it out; Skia draws it, with GPU composition where available | Your Rust processor, natively; Linux, macOS and Windows |
| [Web](https://soundor.dev/docs/web-runtime)   | The browser lays the UI out with the engine's core, as WebAssembly, and draws it in DOM   | The same Rust processor, in an AudioWorklet             |

The React renderer targets Soundor's `soundor:ui` interface. The native runtime
embeds its own UI engine; the web runtime implements the same interface with
browser APIs, and lays it out with the same engine core.

## Start a project

Use Node.js 24 and pnpm 12; npm works too, Yarn and bun are not supported. Install
Rust stable; VST3 builds also need the platform's linker (a C++ compiler driver
on Linux, Apple's Command Line Tools, or Visual Studio's Build Tools). No C++ is
compiled per plugin.

```sh
pnpm create soundor-app my-plugin
cd my-plugin
pnpm doctor
pnpm dev
```

The scaffolder asks for the runtimes, VST3 (the default), web or both, and
`pnpm dev` runs the first of them. Both hosts are managed by their installed
packages; neither needs a `runtimes/` directory or runtime initialization.
It pins every Soundor package to an exact
version: Soundor is pre-1.0, and a minor release can change APIs. To add a
runtime later or try the repository's browser example, follow
[Getting started](https://soundor.dev/docs/getting-started).

## Documentation

All guides and references are on [soundor.dev](https://soundor.dev/docs), from
`apps/website/content/docs/` in this repository. Start with:

- [The idea](https://soundor.dev/docs): what Soundor shares and what you implement.
- [Getting started](https://soundor.dev/docs/getting-started): create a plugin and run it.
- [Architecture](https://soundor.dev/docs/architecture): packages, runtime boundaries, rendering, and threading.
- [Project lifecycle](https://soundor.dev/docs/project-lifecycle): config, code generation, builds, and reloads.
- [React UI](https://soundor.dev/docs/react), [parameters](https://soundor.dev/docs/parameters), and [testing](https://soundor.dev/docs/testing).
- [Contributing](https://soundor.dev/docs/contribute): work on Soundor itself.

The [basic example](https://soundor.dev/docs/examples/basic) implements a gain plugin in both
runtimes. The [primitives example](https://soundor.dev/docs/examples/primitives) demonstrates UI
components, focus, accessibility, canvases, and animation.

## Work on Soundor

```sh
pnpm install
pnpm build
pnpm check
```

Native checks build the engine and its dependencies on the first run. See
[Contributing](https://soundor.dev/docs/contribute) for requirements, focused checks, and example
commands.

## License & Branding

Soundor's software is [MIT licensed](LICENSE). Native dependencies carry their
own notices; see
[engine attribution](https://soundor.dev/docs/engine#licenses-and-attribution).

The Soundor name and the Soundor logos are the project's identity, not part of
the software license: the logo files in [`assets/brand`](assets/brand) have their
own [notice](assets/brand/LICENSE.md). You are free to build and sell plugins,
open source or proprietary, with Soundor under the MIT License, and to say they
are built with Soundor; please don't present them as official Soundor releases.
See the [Brand Guidelines](https://soundor.dev/brand) and [BRANDING.md](BRANDING.md),
and the [Privacy Policy](https://soundor.dev/privacy).
