# Soundor

Build audio plugin UIs in TypeScript and React, and run the same UI in a native
JUCE plugin or a browser.

A Soundor project declares its identity, parameters, typed native API, and
runtimes in `soundor.config.ts`. Soundor generates the shared contract, bundles
the UI, and builds each runtime. You write the audio processing in the runtime's
own language: C++ for JUCE, TypeScript and Web Audio for the browser.

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
[getting started guide](docs/getting-started.md) walks through the configuration
and a working project.

## Two runtimes, one UI

| Runtime                      | UI implementation                                                                         | Audio implementation                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [JUCE](docs/juce-runtime.md) | Hermes runs the UI; Yoga lays it out; Skia draws it, with GPU composition where available | Your C++ processor; VST3, AU on macOS, and Standalone builds |
| [Web](docs/web-runtime.md)   | The browser runs the UI on DOM-backed Soundor nodes                                       | Your TypeScript and Web Audio graph                          |

The React renderer targets Soundor's `soundor:ui` interface. The native runtime
embeds its own UI engine; the web runtime implements the same interface with
browser APIs. Audio processing is implemented separately for each runtime.

## Start a project

Use Node.js 24 and pnpm 12. For native builds, install JUCE and the platform's
C++ toolchain; Soundor discovers an existing JUCE checkout and never downloads it.

```sh
pnpm create soundor-app my-plugin
cd my-plugin
pnpm doctor
pnpm exec soundor dev juce
```

The scaffolder currently creates a JUCE project. To add a browser runtime or try
the repository's browser example, follow [Getting started](docs/getting-started.md).

## Documentation

All guides and references live in [`docs/`](docs/README.md). Start with:

- [The idea](docs/overview.md): what Soundor shares and what you implement.
- [Getting started](docs/getting-started.md): create a plugin and run it.
- [Architecture](docs/architecture.md): packages, runtime boundaries, rendering, and threading.
- [Project lifecycle](docs/project-lifecycle.md): config, code generation, builds, and reloads.
- [React UI](docs/react.md), [parameters](docs/parameters.md), and [testing](docs/testing.md).
- [Contributing](docs/contributing.md): work on Soundor itself.

The [basic example](docs/example-basic.md) implements a gain plugin in both
runtimes. The [primitives example](docs/example-primitives.md) demonstrates UI
components, focus, accessibility, canvases, and animation.

## Work on Soundor

```sh
pnpm install
pnpm build
pnpm check
```

Native checks build the engine and its dependencies on the first run. See
[Contributing](docs/contributing.md) for requirements, focused checks, and example
commands.

## License

Soundor is [MIT licensed](LICENSE). Native dependencies carry their own notices;
see [engine attribution](docs/engine.md#licenses-and-attribution). JUCE is a
separate dependency with its own license.
