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
[getting started guide](https://soundor.dev/docs/getting-started) walks through the configuration
and a working project.

## Two runtimes, one UI

| Runtime                                       | UI implementation                                                                         | Audio implementation                                         |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [JUCE](https://soundor.dev/docs/juce-runtime) | Hermes runs the UI; Yoga lays it out; Skia draws it, with GPU composition where available | Your C++ processor; VST3, AU on macOS, and Standalone builds |
| [Web](https://soundor.dev/docs/web-runtime)   | The browser runs the UI on DOM-backed Soundor nodes                                       | Your TypeScript and Web Audio graph                          |

The React renderer targets Soundor's `soundor:ui` interface. The native runtime
embeds its own UI engine; the web runtime implements the same interface with
browser APIs. Audio processing is implemented separately for each runtime.

## Start a project

Use Node.js 24 and pnpm 12; npm works too, Yarn and bun are not supported. For
native builds, install JUCE and the platform's C++ toolchain; Soundor discovers
an existing JUCE checkout and never downloads it.

```sh
pnpm create soundor-app my-plugin
cd my-plugin
pnpm doctor
pnpm exec soundor dev juce
```

The scaffolder currently creates a JUCE project. It pins every Soundor package
to an exact version: Soundor is pre-1.0, and a minor release can change APIs.
To add a browser runtime or try the repository's browser example, follow
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

## License

Soundor is [MIT licensed](LICENSE). Native dependencies carry their own notices;
see [engine attribution](https://soundor.dev/docs/engine#licenses-and-attribution). JUCE is a
separate dependency with its own license.
