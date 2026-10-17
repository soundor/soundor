---
title: 'Best practices'
description: 'How to write tests that check what a user gets, and keep passing while the code changes.'
---

A good test reads like what a user does, and fails only when what they get
changes. These habits get there.

## Test the app, not its parts

Render the application component (`src/App.tsx`, which `main.tsx` only
mounts) or a whole feature, and test it through what it shows. Tests of a
component's internals break on every refactor; tests of its behavior break
when the behavior does.

## Find controls as a user does

Query by role and name first: `screen.getByRole('button', { name: 'Save' })`.
It is what a screen reader announces, so a test that finds a control this
way also checks that the control is accessible. Then
[`ByLabelText`](/docs/testing/by-label-text) and
[`ByText`](/docs/testing/by-text). There are no test ids: a control a test
cannot find by its role and name is a control a screen-reader user cannot
find either.

```tsx
// Good: what it is and what it is called.
screen.getByRole('adjustable', { name: 'Gain' });
// Brittle: the copy changes, and nothing says it is a button.
screen.getByText('Reset');
```

## Act with userEvent

[`userEvent`](/docs/testing/user-event) does what a user does: a click is
pointer down, up and a click, with focus moving and the default actions
following, as in the runtime. [`fireEvent`](/docs/testing/fire-event) sends
one event and nothing else; keep it for what `userEvent` cannot do (a pen,
a touch, an accessibility action). Make one session per test:
`const user = userEvent.setup()`.

## Await everything

`render`, every interaction, `waitFor`, `findBy…` and `advanceTime` return
promises: await each. React's updates are applied when they settle; a
missing `await` shows as a test that passes or fails by chance.

## Use the real contract

The plugin's parameters and native API come from its config. Set state with
[`testParameters`](/docs/testing/test-parameters) and
[`testHost`](/docs/testing/test-host), mock native methods with
[`mockNative`](/docs/testing/mock-native), in the test or in `beforeEach`.
Check a parameter through `soundor:parameters` itself:
`expect(parameters.gain.get()).toBe(0.5)`.

## Wait for what is asynchronous, and only that

Storage, files, native async methods and effects settle later: wait for
their result with [`waitFor`](/docs/testing/wait-for) or a `findBy` query.
Animations do not run on their own: move time with
[`advanceTime`](/docs/testing/advance-time) and check where they ended
(`node.presentation`). Never wait with `setTimeout`.

## Keep tests apart

Every test gets a fresh runtime: nodes, parameters, storage and the host
start over. Put setup in `beforeEach` or the test itself, never in
`beforeAll` or at the top of the file, where it runs once against a runtime
that is gone by the first test.

## Know what a test cannot check

There is no layout, no drawing and no audio in a test. Positions, pixels,
canvases and sound need the plugin: [`soundor dev`](/docs/cli/dev), and
the native and browser tests of the runtimes themselves.
