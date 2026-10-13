# @soundor/vitest

Vitest integration for the **simulated** Soundor runtime. Tests run in Node,
without a browser, Hermes, native libraries, or audio hardware. Vitest 5 is the
supported runner; Vite 8 is the supported transform backend.

## Quick start

```sh
pnpm add -D vitest @soundor/vitest vitest-environment-soundor
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { soundor } from '@soundor/vitest';

export default defineConfig({
  plugins: [soundor()],
  test: { environment: 'soundor' },
});
```

No aliases or setup file are needed. TS and TSX use Vite's automatic JSX
transform. Published `@soundor/react` is transformed through Vite so its
`soundor:ui` imports work too; React remains an application dependency.

```ts
import { test, expect, vi } from 'vitest';
import { createTextInput, root } from 'soundor:ui';
import { getTestRuntime } from '@soundor/vitest';

test('focuses an input', () => {
  const input = createTextInput({ value: 'Soundor' });
  root.appendChild(input);
  input.focus();
  expect(getTestRuntime().focusedNode()).toBe(input);
});
```

The Testing Library package and its React helpers are added in the next stage
of the testing infrastructure; the final installation also includes
`@soundor/testing-library` as a direct devDependency.

## Configuration and declarations

`soundor()` discovers `soundor.config.ts` in the project or its parents. It uses
Soundor's existing configuration loader and declaration generator, and updates
`.soundor/generated`. Invalid configurations fail with the usual Soundor errors.
The file and imported native declarations describe the simulated API; no native
runtime starts. Include `.soundor/generated/*.d.ts` in the test TypeScript project
alongside the test files, using the same declarations as the application.

A library without a Soundor project can use `soundor({ config: false })`, or
supply `runtime.parameters`, `runtime.plugin`, and `native` declarations.
Without a discovered project, omitted options provide an empty test plugin.
`config: './soundor.config.ts'` selects an explicit file. A configured project
owns its parameter and native declarations; state changes belong in test hooks.
Configuration changes restart the test server in watch mode.

```ts
plugins: [soundor({ runtime: { host: { sampleRate: 96000 } } })];
```

Each test starts with this initial state. In tests:

```ts
import { beforeEach, vi } from 'vitest';
import { getTestRuntime } from '@soundor/vitest';

beforeEach(() => {
  const runtime = getTestRuntime();
  runtime.parameters.byId.gain!.set(0.75);
  runtime.setHost({ hostName: 'Test DAW' });
  runtime.mockNative(
    'loadPreset',
    vi.fn(async () => ({ name: 'Warm' })),
  );
});
```

Use the return shape declared by your native API. Unconfigured native methods
fail clearly; async declarations return promises. Ordinary module mocks use
`vi.mock` and function mocks use `vi.fn`.

## Isolation and cleanup

The environment owns a runtime per test, explicitly managed by Vitest's
`aroundEach` hook. Module factories, root bindings, parameter handles, storage,
and host subscriptions follow the active instance. Nodes and subscriptions from
an earlier test cannot be reused. Put state setup in `beforeEach`, rather than
`beforeAll` or module initialization. User cleanup hooks run before disposal,
even when a test fails. Soundor cleanup does not reset user mocks: Vitest's
`clearMocks`, `mockReset`, and `restoreMocks` retain their normal behavior.

Parallel **test files** are supported in standard forks/threads pools. Tests in
one file must run sequentially; `test.concurrent` is rejected. Keep
`test.isolate` enabled (the default). VM pools are not supported.

Animation time is explicit: `getTestRuntime().advanceTime(250)`. The environment
provides `requestAnimationFrame`/`cancelAnimationFrame`, simulating 60 Hz frame
batches on that clock, with native ordering and cancellation semantics. This
also supports React's `useAnimationFrame`. Frame timestamps use runtime time;
Node timers and `performance.now()` remain on Node's clock. Vitest fake timers
can control Node timers independently; they do not advance native presentation.
Select `toFake` explicitly to keep the simulated frame functions when using
Vitest timers. `devicePixelRatio` defaults to 1; no pixels are rendered.

## Simulation limits

UI trees, input, accessibility, parameters, host state, clipboard, JSON storage,
and animation lifecycle are simulated. Layout, rendering, Hermes execution,
audio, and DAW integration are unavailable. `soundor:fs` resolves, but operations
reject with an explanation; supply a `vi.mock('soundor:fs')` when needed.
Storage is in memory and resets between tests. See
[@soundor/test-runtime](../test-runtime/README.md) for the runtime's full limits.

The root plugin explicitly configures simulation. There is no native entry
point or backend switch. The plugin and testing tools do not require an
environment package as a peer; install the chosen environment directly.

pnpm's default automatic peer installation supplies the compatible Vite 8 peer. Projects
that disable automatic peer installation must install a compatible Vite version
as required by the plugin and Vitest (this repository uses Vite 8).

## Package consumer validation

```sh
pnpm turbo run build --filter=@soundor/vitest...
pnpm --filter @soundor/vitest test:consumer
```

The smoke test packs the real packages, installs them in an external project
with isolated node_modules and strict peers, runs React interaction tests, and
checks public TypeScript declarations. No workspace aliases or direct
`@soundor/test-runtime` dependency are used.
