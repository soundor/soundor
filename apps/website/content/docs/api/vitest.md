---
title: 'Vitest plugin'
description: '@soundor/vitest: configuration, generated declarations, isolation, and consumer validation.'
---

Source: [`packages/vitest/`](https://github.com/soundor/soundor/tree/main/packages/vitest).

Vitest integration for the **simulated** Soundor runtime. Tests run in Node,
without a browser, Hermes, native libraries, or audio hardware. Vitest 5 is the
supported runner; Vite 8 is the supported transform backend.

## Quick start

```sh
pnpm add -D vitest @soundor/vitest vitest-environment-soundor @soundor/testing-library
```

```ts
import { soundor } from '@soundor/vitest';
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [soundor()],
  test: { environment: 'soundor' },
});
```

No aliases or setup file are needed. TS and TSX use Vite's automatic JSX
transform. Published `@soundor/react` is transformed through Vite so its
`soundor:ui` imports work too; React remains an application dependency.

```ts
import { createTextInput, root } from 'soundor:ui';
import { test, expect } from 'vitest';

test('focuses an input', () => {
  const input = createTextInput({ value: 'Soundor' });
  root.appendChild(input);
  input.focus();
  expect(input).toHaveFocus();
});
```

See [@soundor/testing-library](/docs/api/testing-library) for rendering, semantic
queries, and stateful user interactions.

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
import {
  testParameters,
  testHost,
  mockNative,
} from '@soundor/testing-library/react';
import { beforeEach, vi } from 'vitest';

beforeEach(() => {
  testParameters.set('gain', 0.75);
  testHost.set({ hostName: 'Test DAW' });
  mockNative(
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

Animation time is explicit: `await advanceTime(250)`. The environment
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
[@soundor/test-runtime](/docs/contribute/test-runtime) for the runtime's full limits.

The root plugin explicitly configures simulation. There is no native entry
point or backend switch. The plugin and testing tools do not require an
environment package as a peer; install the chosen environment directly.

pnpm's default automatic peer installation supplies the compatible Vite 8 peer. Projects
that disable automatic peer installation must install a compatible Vite version
as required by the plugin and Vitest (this repository uses Vite 8).

## Package consumer validation

```sh
pnpm build
pnpm --filter @soundor/vitest test:consumer
```

The smoke test packs the real packages, installs them in an external project
with isolated node_modules and strict peers, runs React interaction tests, and
checks public TypeScript declarations. No workspace aliases or direct
`@soundor/test-runtime` dependency are used.

### Focus assertions and simulated setup

The existing `soundor()` plugin automatically registers `expect(node).toHaveFocus()`
and its negation. It reads Soundor focus, including portals and nested dialogs;
foreign, detached, stale, and disposed-runtime nodes fail clearly, even with `.not`.
Matcher types are included by importing `@soundor/vitest` in the TypeScript project
(normally through `vitest.config.ts`). If your test TypeScript project excludes that
config, add `"@soundor/vitest"` to `compilerOptions.types` or a type-only import.
No DOM matchers or additional setup file are needed.

```tsx
await user.tab();
expect(screen.getByRole('button', { name: 'Open dialog' })).toHaveFocus();
```

`testParameters.set(id, value)` validates declared IDs and value types at runtime,
uses plain units, clamps numbers, rounds integers, and notifies subscriptions.
`testHost.set(partialSnapshot)` merges the existing host snapshot and notifies
subscribers; `transport` is a complete transport snapshot or `null`.
`mockNative(name, implementation)` registers a declared native method with a normal
function (including synchronous or asynchronous `vi.fn()`), preserving thrown
errors and rejections. Unknown methods and non-function mocks fail clearly.
All three helpers use the current test's runtime and reset with it. Use them in
`beforeEach` or a test, rather than `beforeAll` or module initialization.
The React entry coordinates parameter and host updates with synchronous `act`,
both before rendering and after subscriptions mount. The root entry provides the
same helpers without React.

These setup helpers specifically configure the simulated environment; future
native environments may require different setup. Queries, interactions, focus
assertions and presentation assertions describe application behavior, but native
support is not implemented or promised by these APIs today.
Use `await advanceTime()` and `node.presentation` for application animation tests.
Animation registry counts, ownership and cleanup belong in test-runtime unit tests.
Renderer implementation tests may inspect submitted animation handles to verify
reconciler behavior. `getTestRuntime()` from `@soundor/vitest` remains a deprecated
advanced escape hatch for compatibility; runtime implementation tests should
import context helpers and `createTestRuntime()` from `@soundor/test-runtime`.
