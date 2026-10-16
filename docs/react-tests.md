# React tests

[Documentation](README.md) · [The idea](overview.md) · [Getting started](getting-started.md) · [Architecture](architecture.md)

Source: [`packages/react/testing/`](../packages/react/testing/).

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

---

Previous: [@soundor/test-runtime](test-runtime.md) · Next: [@soundor/core](core.md)
