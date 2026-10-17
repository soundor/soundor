---
title: 'React renderer tests'
description: 'The private React test workspace: dependency boundaries and focused test commands.'
---

Source: [`packages/react/testing/`](https://github.com/soundor/soundor/tree/main/packages/react/testing).

Private test workspace for `@soundor/react`. It declares the four public testing
dependencies and uses the published renderer entry. This keeps the renderer's
package graph independent of its testing tools, which themselves use the
renderer for their integration tests.

```sh
pnpm build
pnpm --filter @soundor/react test
pnpm --filter @soundor/react-tests exec vitest run src/modal.test.tsx
```

The root test command delegates through the renderer and excludes this workspace
as a second task, so each suite runs once. Root build includes its type checks. The renderer's Turbo test/watch tasks explicitly
depend on this workspace's build, so filtered runs build their tools and invalidate
the test cache when the suites change.
Public Testing Library helpers own React `act` and automatic cleanup; semantic
queries and user interactions cover component behavior. Tests of listener/style
replacement, low-level refs, or animation submission still inspect actual test
runtime nodes. The few native error-reporting contract tests use `createRoot`
and `flushSync` deliberately outside `act`.

## The examples' tests

The renderer's 84 tests live in the private `packages/react/testing` workspace.
It directly declares the testing packages and renderer, avoiding a dependency
cycle between the renderer and its test tools. `pnpm --filter @soundor/react test`
continues to run this suite. Renderer-specific checks inspect actual runtime
nodes where necessary; component tests use semantic queries and user actions.
The old `src/testing/fake-ui.ts` adapter is removed.

The examples export their application component from `src/App.tsx`; `main.tsx`
only mounts it. Their tests import the same application, use public testing
exports, and read the real generated parameter/host contracts. No testing props
or alternate application implementation are involved.

```sh
pnpm build
pnpm --filter @soundor/react test
pnpm --filter basic --filter primitives test
pnpm --filter basic --filter primitives typecheck
pnpm --filter basic --filter primitives build:web
pnpm --filter @soundor/vitest test:consumer
pnpm check
```

Root checks exclude examples, so the example commands are required separately.
CI also runs their tests, type checks, and web builds explicitly. The examples'
Vitest include only scans `src/**/*.test.{ts,tsx}`, excluding native build caches.
`basic` tests sequential keyboard gain adjustment, preset editing/storage, reset,
and host/parameter subscriptions. `primitives` tests pointer/keyboard/accessibility
knob changes, nested modal focus, hosted portals, and animation lifecycle.

Native application builds remain separate: `pnpm --filter basic --filter primitives
exec soundor build juce`. CI does not build the examples natively; the JUCE
integration job builds `@soundor/juce-runtime`'s own test plugin
(`pnpm --filter @soundor/juce-runtime test:plugin`). These simulated tests cannot replace native runtime
checks or validate pixels, DSP, plugin formats, or host integration. Future native
Vitest support can supply its own environment and `@soundor/vitest/native` plugin;
no placeholder native entry point is published today.
