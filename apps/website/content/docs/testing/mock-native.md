---
title: 'mockNative'
description: "Implements one of the plugin's native methods for a test, and publishes its native events (emitNative) and channels (publishChannel)."
---

```ts
mockNative(name: string, implementation: (...args: any[]) => unknown): void;
```

Implements the native method `name`, declared in the config's `native` API,
for the test: what `soundor:native` calls. Usually a Vitest mock, so the test
can check its calls too.

```ts
beforeEach(() => {
  mockNative('loadPreset', vi.fn(async () => ({ name: 'Warm' })));
});

test('loads a preset', async () => {
  await render(<App />);
  await user.click(screen.getByRole('button', { name: 'Load' }));
  expect(await screen.findByText('Warm')).toBeDefined();
});
```

## Good to know

- **Declared methods only:** an unknown name, or something not a function,
  throws. A method a test calls without a mock fails, saying so.
- **Return the declared shape:** a promise for an `async` method; thrown
  errors and rejections reach the UI as they would.
- **Other modules** are mocked with Vitest itself: `vi.mock('soundor:fs')`
  for files. Storage is real, in memory, and empty in every test.

## Native events

```ts
emitNative(name: string, value?: unknown): void;
```

Publishes the native event `name`, declared under `native.events`, as the
plugin's native code does: its subscribers (`events.<name>` of
`soundor:native`) receive `value` now, inside `act()` with
`@soundor/testing-library/react`. An undeclared name throws.

```ts
test('shows the loaded preset', async () => {
  await render(<App />);
  emitNative('presetLoaded', { path: 'warm.json', preset: null });
  expect(screen.getByText('warm.json')).toBeDefined();
});
```

## Channels

```ts
publishChannel(name: string, value: unknown): void;
```

Publishes a value to the native channel `name`, declared under
`native.channels`, as the plugin's native code does: `channels.<name>.get()`
returns it, and its subscribers receive it now with the next sequence number
(1 for the first), inside `act()` with `@soundor/testing-library/react`. Every
value is delivered: there are no frames to skip any. An undeclared name
throws.

```ts
test('shows the peak', async () => {
  await render(<App />);
  publishChannel('peak', -6.02);
  expect(screen.getByText('Peak -6.0 dB')).toBeDefined();
});
```
