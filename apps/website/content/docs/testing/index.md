---
title: 'Testing'
description: 'Test a plugin UI in Node, without a DAW: render it, find what a user sees, act as a user, and check what happens.'
---

A Soundor UI is tested like a user uses it: render it, find a control by what
it is (a button called "Save"), act on it (click, type, press a key), and
check what happens. Tests run in Node with [Vitest](https://vitest.dev),
against a simulated Soundor runtime: no DAW, no plugin build, no browser.

```tsx
import {
  render,
  screen,
  testParameters,
  userEvent,
} from '@soundor/testing-library/react';
import { parameters } from 'soundor:parameters';
import { expect, test } from 'vitest';

import { App } from './App';

test('resets the gain', async () => {
  const user = userEvent.setup();
  testParameters.set('gain', 0.75);
  await render(<App />);
  await user.click(screen.getByRole('button', { name: 'Reset gain' }));
  expect(parameters.gain.get()).toBe(0.5);
  expect(screen.getByText('0.50')).toBeDefined();
});
```

## Set up

A new project from [`create-soundor-app`](/docs/cli/create-soundor-app) is
set up already. Otherwise, install the four packages:

```sh
pnpm add -D vitest @soundor/vitest vitest-environment-soundor @soundor/testing-library
```

and add the plugin and the environment to `vitest.config.ts`:

```ts
import { soundor } from '@soundor/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [soundor()],
  test: { environment: 'soundor' },
});
```

The plugin reads `soundor.config.ts`, so `soundor:parameters` and the native
API in tests are the plugin's own ([`soundor()`](/docs/testing/vitest)). Each
test gets a fresh runtime ([the environment](/docs/testing/vitest-environment-soundor)).

## What to use

| To…                              | Use                                                                                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Render a component               | [`render`](/docs/testing/render)                                                                                                                                                       |
| Find what a user sees            | [queries](/docs/testing/queries): [`ByRole`](/docs/testing/by-role), [`ByText`](/docs/testing/by-text), [`ByLabelText`](/docs/testing/by-label-text), [`within`](/docs/testing/within) |
| Act as a user                    | [`userEvent`](/docs/testing/user-event): `click`, `type`, `keyboard`, `tab`, `press`, `clear`, `pointer`                                                                               |
| Fire one event                   | [`fireEvent`](/docs/testing/fire-event)                                                                                                                                                |
| Wait for something               | [`waitFor`](/docs/testing/wait-for) and the `findBy` queries                                                                                                                           |
| Move animations forward          | [`advanceTime`](/docs/testing/advance-time)                                                                                                                                            |
| Set parameters, the host, native | [`testParameters`](/docs/testing/test-parameters), [`testHost`](/docs/testing/test-host), [`mockNative`](/docs/testing/mock-native)                                                    |
| Check focus                      | [`toHaveFocus`](/docs/testing/to-have-focus)                                                                                                                                           |

[Best practices](/docs/testing/best-practices) says how to put them together.

## What a test can and cannot see

Simulated: the node tree, input and its default actions, focus,
accessibility, parameters, the host, the native API (mocked), the
clipboard, JSON storage, and animations on a virtual clock.

Not simulated: layout and pixels (no positions, nothing drawn), canvas
drawing, audio, a DAW, Hermes and the native engine, and `soundor:fs` (mock
it with `vi.mock('soundor:fs')`). A test checks behavior; what it looks like,
and how it sounds, needs the plugin itself.

Without React, the root entry `@soundor/testing-library` has the same
queries, interactions and helpers for tests of plain `soundor:ui` nodes.
