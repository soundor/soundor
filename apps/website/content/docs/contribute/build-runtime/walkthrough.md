---
title: 'A minimal runtime package'
description: 'Build and check a lifecycle package, then connect its execution backend.'
---

This walkthrough starts with a small lifecycle package. You can register it,
initialize host files, generate a manifest and run doctor before implementing
its execution backend. Development and build report an explicit error until
that backend is connected.

## 1. Create the package

Create a TypeScript package with an ESM entry and declarations. Install the
runtime SDK and its peers:

```sh
pnpm add @soundor/runtime-sdk @soundor/config @soundor/core
pnpm add -D typescript @types/node
```

Use exact matching Soundor versions while developing the package. Its public
entry will export `demoRuntime`; a plugin config imports that factory. See
[Publishing](/docs/contribute/build-runtime/publishing) for dependency placement
and the published exports.

## 2. Define the five phases

Put this in `src/index.ts`:

```ts
import { defineRuntime, RuntimeError } from '@soundor/runtime-sdk';

export interface DemoOptions {
  label?: string;
}

export const demoRuntime = defineRuntime<DemoOptions>({
  id: 'demo',

  async init(_config, ctx) {
    const file = ctx.fs.resolve('runtimes', 'demo', 'README.md');
    if (!(await ctx.fs.exists(file))) {
      await ctx.fs.write(file, '# Demo host\n\nYour host code belongs here.\n');
    }
  },

  async gen(config, ctx) {
    const label = ctx.options.label;
    if (label !== undefined && typeof label !== 'string') {
      throw new RuntimeError('demo.label must be a string.');
    }
    ctx.codegen.emit({
      path: 'manifest.json',
      contents:
        JSON.stringify(
          {
            pluginId: config.plugin.id,
            pluginName: config.plugin.name,
            label: label ?? config.plugin.name,
          },
          null,
          2,
        ) + '\n',
    });
  },

  async dev() {
    throw new RuntimeError('Connect the demo development backend first.');
  },

  async build() {
    throw new RuntimeError('Connect the demo production backend first.');
  },

  async doctor() {
    return {
      checks: [
        {
          label: 'Execution backend',
          status: 'fail',
          detail:
            'The lifecycle package is installed; execution is not connected.',
          suggestion: 'Implement the backend, then wire dev and build to it.',
        },
      ],
    };
  },
});
```

The runtime ID is the directory and dispatch identity, independent of the npm
package name. `init` writes through the filesystem only when the user file is
missing. `gen` emits contents through the sink, so the CLI controls writes and
check mode. Options need runtime validation even though the factory is typed.

When options affect several phases, move validation into a shared resolver and
call it from every phase that uses them. The example validates `label` where
the generated manifest consumes it.

## 3. Register it in a project

Build the package and make it available to a plugin through a workspace or a
local package install. Add its factory to the plugin's existing config:

```ts
import { demoRuntime } from 'soundor-runtime-demo';

// Inside defineSoundorConfig({ ... }):
runtimes: [demoRuntime({ label: 'Local demo' })],
```

Run from the plugin project:

```sh
pnpm exec soundor init demo
pnpm exec soundor gen
pnpm exec soundor gen --check
pnpm exec soundor doctor
```

`init` creates `runtimes/demo/README.md`. `gen` writes the manifest into
`.soundor/generated/runtimes/demo/`, alongside core's portable declarations.
Doctor reports the missing execution backend. `soundor gen` and `--check`
operate on all configured runtimes; keep only `demo` configured for an isolated
exercise.

Edit the README and run `init` again: it must preserve the edit. Change the
label in config: check mode should report the stale manifest, and a subsequent
`gen` should update it. These are useful first tests for your package.

## 4. Connect execution

Choose [an engine backend or an independent implementation](/docs/contribute/build-runtime/implementation).
The backend supplies the modules and globals in the
[execution contract](/docs/contribute/build-runtime/contract). Extend the
manifest and generated sources with the parameter and native API model that
backend consumes.

Replace `dev` with the development launcher or server. Consume `ctx.ui`, watch
the UI build marker, report readiness and keep the phase alive until abort.
Replace `build` with production compilation or bundling under `ctx.paths.dist`.
Handle an absent UI entry, forward the abort signal to child processes, and
close resources in `finally`. Use `runCommand` when invoking build tools so
their output flows through the runtime logger.

For engine-based builds, keep headers, static libraries and `hermesc` on the
same exact engine version. A backend with macOS binaries signs them as the
last bundle-writing step using `ctx.signing`.

## 5. Add evidence before publishing

Test the lifecycle with injected filesystems, codegen sinks and command runners.
Test repeat initialization, deterministic generation, option failures, missing
tools and cancellation. Then run execution and platform tests for
[conformance](/docs/contribute/build-runtime/conformance). Doctor should report
the actual backend's readiness once it is implemented.

The reference runtime phase tests show how to separate command invocation from
the real compiler or server. Their plugin and browser fixtures show the next
layer: exercising an installed runtime with a real UI and platform backend.
