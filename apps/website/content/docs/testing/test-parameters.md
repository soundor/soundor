---
title: 'testParameters'
description: "Sets a plugin parameter's value in a test, as the host would."
---

```ts
testParameters.set(id: string, value: number | boolean | string): void;
```

Sets the parameter `id` (declared in the config) to `value`, as the host's
automation would: subscribers hear it, and components using
[`useParameter`](/docs/hooks/use-parameter) re-render.

```ts
beforeEach(() => {
  testParameters.set('gain', 0.75);
});

test('shows the gain', async () => {
  await render(<App />);
  expect(screen.getByText('0.75')).toBeDefined();
});
```

## Good to know

- **Checked like the real thing:** an unknown id or a value of the wrong
  type throws; numbers are clamped to the range, ints rounded.
- **Read with `soundor:parameters`:** `parameters.gain.get()`, in the test,
  is the value the plugin has.
- **Per test:** values start from their defaults in every test. Set them in
  the test or `beforeEach`, never in `beforeAll`.
