# Testing Soundor

Test Soundor applications through their UI and accessibility behavior. Vitest is
the supported runner. Tests run against the in-memory Soundor runtime in Node;
they do not execute Hermes, C++, or a browser.

## Installation and configuration

Install all four testing dependencies directly:

```sh
pnpm add -D vitest @soundor/vitest vitest-environment-soundor @soundor/testing-library
```

React applications also need their normal `react` and `@soundor/react`
dependencies. React peers are optional for the framework-independent root entry.

```ts
import { soundor } from '@soundor/vitest';
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [soundor()],
  test: { environment: 'soundor' },
});
```

The plugin uses `soundor.config.ts` and generates the usual `soundor:*`
declarations. Include `.soundor/generated/*.d.ts` in your TypeScript project.
Component libraries without a project can use `soundor({ config: false })`.
No aliases, setup file, DOM environment, or direct runtime installation are needed.

```tsx
import { Pressable, Text } from '@soundor/react';
import { render, screen, userEvent } from '@soundor/testing-library/react';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';

function Counter({ onChange }: { onChange: (value: number) => void }) {
  const [count, setCount] = useState(0);
  return (
    <>
      <Pressable
        accessibilityLabel="Increment"
        onPress={() => {
          setCount(count + 1);
          onChange(count + 1);
        }}
      >
        <Text>Increment</Text>
      </Pressable>
      <Text>Count: {count}</Text>
    </>
  );
}

test('increments the counter', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  await render(<Counter onChange={onChange} />);
  await user.click(screen.getByRole('button', { name: 'Increment' }));
  expect(onChange).toHaveBeenCalledWith(1);
  expect(screen.getByText('Count: 1')).toBeDefined();
});
```

## Unit tests

Pure TypeScript helpers use ordinary Vitest assertions and mocks. A project can
use the same configuration for unit, component, and application integration tests.
There is no second test runner or mocking framework.

```ts
import { expect, test } from 'vitest';

import { clampGain } from './gain';

test('bounds gain', () => {
  expect(clampGain(2)).toBe(1);
});
```

For runtime unit tests, use public `soundor:ui` factories and the root Testing
Library entry. For example, `createTextInput()`, assign `node.accessibility`,
append it to `root`, then `await user.type(screen.getByRole('textinput'), 'Warm')`.
Nodes are Soundor nodes, not DOM elements: use Vitest assertions on their values,
accessibility state, and presentation rather than DOM matcher packages.

## Rendering and lifecycle

The `/react` entry uses the real Soundor reconciler and React `act`. Await
`render`, `rerender`, `unmount`, interactions, async queries, and clock advances.
Each render has its own container. Its returned queries and `screen` include
portals; `within(container)` scopes queries by logical accessibility ownership.
Supply `{ container }` to render into an existing node, or `{ wrapper }` to
wrap the component in Context providers. Refs and effects work normally.

```tsx
const result = await render(<Counter onChange={() => {}} />);
await result.rerender(<Counter onChange={onChange} />);
await result.unmount();
```

Roots are automatically unmounted after every test, including failures, before
the environment disposes its runtime. `await cleanup()` explicitly unmounts all
roots. Runtime state is fresh per test. Create user sessions and nodes inside
tests or `beforeEach`. Same-file `test.concurrent` is unsupported; parallel test
files use independent workers. Arbitrary external React state updates can use
`await act(() => update())` from the React entry.

## Queries and debugging

Both entries export `screen`, `within`, and semantic queries:

| Query family                               | Result                                      |
| ------------------------------------------ | ------------------------------------------- |
| `getByRole`, `getByText`, `getByLabelText` | One match, or a useful error                |
| `queryBy*`                                 | One match or `null`; multiple matches throw |
| `getAllBy*`                                | All matches; zero matches throw             |
| `queryAllBy*`                              | All matches, including an empty array       |
| `findBy*`, `findAllBy*`                    | Async retry through `waitFor`               |

Roles follow Soundor: `textinput` and `adjustable` are native roles. Accessible
names include nested text unless an explicit label replaces it. Labels query
`accessibilityLabel`; there is no HTML label association. Role filters support
`name`, `description`, `disabled`, `selected`, `checked` (including `mixed`),
`expanded`, `busy`, and `value: { min, max, now, text }`.

Text matchers accept strings, regular expressions, or `(text, node) => boolean`.
Whitespace is normalized by default; `{ exact: false }` matches substrings,
and `normalizer` customizes normalization. Text queries include visible input
values/placeholders. Hidden nodes and modal background content are excluded;
`{ hidden: true }` explicitly includes them. Portal queries follow logical
accessibility parents. Collapsed accessible leaves retain their combined name.

`screen.debug()` prints a bounded semantic tree with roles, names, descriptions,
states, and values. Missing and ambiguous query errors include this tree.

## User interactions

`userEvent.setup()` creates a session that retains pointer buttons, focus, and
keyboard modifiers. Interactions dispatch native event sequences and default
actions; they do not call React props directly. Disabled or hidden nodes are
ignored. Detached and foreign nodes throw. Each session belongs to one test.

```ts
const user = userEvent.setup();
await user.click(screen.getByRole('button', { name: 'Open' }));
await user.type(screen.getByRole('textinput', { name: 'Name' }), 'Soundor');
await user.clear(screen.getByLabelText('Name'));
await user.tab();
await user.tab({ shift: true });
await user.keyboard('{Control>}a{/Control}{Backspace}');
await user.press(screen.getByRole('button', { name: 'Save' }));
```

`type` treats its string literally, focuses by clicking, and uses TextInput
selection/default editing. `keyboard` accepts characters, `{Enter}`, `{Tab}`,
`{ArrowLeft}`, held `{Shift>}` and release `{/Shift}` descriptors, physical
`[KeyA]`/`[Digit1]`, and escaped `{{`/`[[`. `press` focuses and sends Enter.
Soundor's supported input editing rules apply; this is not a keyboard-layout or
IME simulator.

```ts
await user.pointer({ target: button, keys: '[MouseLeft>]' });
await user.pointer({ target: other, clientX: 20, clientY: 10 });
await user.pointer({ target: other, keys: '[/MouseLeft]' });
```

Pointer targets are explicit because no layout/hit testing runs. Primary,
middle, and secondary mouse buttons are supported, including simultaneous
buttons and capture until the last release. Native click targeting uses the
deepest common physical ancestor of press/release targets.

`fireEvent` is the lower-level escape hatch. It has `pointerDown`, `pointerMove`,
`pointerUp`, `pointerCancel`, `keyDown`, `keyUp`, `beforeInput`, `input`, `change`,
`click`, `focus`, `blur`, and `accessibilityAction`, plus
`fireEvent(node, eventName, options)`. Fields and names follow `soundor:ui`.
The React entry wraps dispatch in synchronous `act`; complete interaction
sessions should use `userEvent`.

## Async assertions and animation time

```ts
await waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 1000 });
await screen.findByRole('button', { name: 'Ready' });
await advanceTime(250);
```

`waitFor` retries when the assertion throws/rejects. Defaults are a 1000 ms
timeout and 20 ms interval; even a never-settling callback has a real deadline.
Assertions should be read-only. The React entry flushes updates between retries.

`advanceTime` advances the simulated clock in frame-sized steps, allowing React
commits between frame callbacks. It updates native animation presentation,
completion, and lifecycle without real waits. Base styles and presentation are
separate; inspect `node.presentation` for animated values. It also advances
Vitest Node timers when fake timers are active. `waitFor` advances fake Node
timers, but does not advance simulated animation time automatically.

Keep simulated frame functions when enabling fake timers:

```ts
vi.useFakeTimers({
  toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
});
const user = userEvent.setup({
  delay: 1,
  advanceTimers: vi.advanceTimersByTimeAsync,
});
// ... await interactions and advanceTime ...
vi.useRealTimers();
```

Without fake timers, Node timers retain real time. The default user delay is zero.
With a positive delay and fake timers, provide `advanceTimers` to avoid hangs.

## Parameters, host and native services

Use the focused setup helpers to configure the simulated environment.
Ordinary mocks remain Vitest mocks; cleanup does not reset unrelated mocks.

```ts
import {
  testParameters,
  testHost,
  mockNative,
} from '@soundor/testing-library/react';

beforeEach(() => {
  testParameters.set('gain', 0.75);
  testHost.set({ hostName: 'Test DAW' });
  mockNative(
    'loadPreset',
    vi.fn(async () => ({ name: 'Warm' })),
  );
});
```

Parameter definitions and native return types come from the project config.
Unconfigured native services fail clearly. Storage is in-memory JSON storage.
Use `vi.mock('soundor:fs')` for filesystem behavior; filesystem operations are
unsupported by the simulation.

## Framework-independent testing

Import queries, interactions, `fireEvent`, `waitFor`, and `advanceTime` from
`@soundor/testing-library` for vanilla `soundor:ui` tests. This entry does not
load React or require React peers. Append nodes through `soundor:ui`, then query
and interact with the same semantic APIs. Rendering helpers and React `act`
are exclusively exported by `/react`.

## Limitations

There is no layout, graphics, screenshot output, canvas drawing, audio, DAW,
Hermes execution, native engine integration, or browser DOM. Pointer targets
are supplied by tests. The current interaction session models a mouse and
Soundor's keyboard editing subset; pen/touch event payloads can be dispatched
with `fireEvent`. Native testing is a future separate environment; neither the
plugin nor Testing Library requires the simulated environment as a peer.

## Repository tests and examples

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
exec soundor build juce`. These simulated tests cannot replace native runtime
checks or validate pixels, DSP, plugin formats, or host integration. Future native
Vitest support can supply its own environment and `@soundor/vitest/native` plugin;
no placeholder native entry point is published today.

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
