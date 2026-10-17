---
title: 'mockNative'
description: "Implements one of the plugin's native methods for a test."
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
